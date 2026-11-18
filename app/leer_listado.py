"""Lee un archivo de listado (Excel, Word, PDF o imagen) y devuelve sus filas en el formato del listado:
NOMBRE<TAB>TALLA<TAB>NÚMERO<TAB>DISEÑO<TAB>GÉNERO<TAB>OBSERVACIÓN. Detecta la fila de encabezados por su nombre."""
import io
import asyncio
import os
import re
import subprocess
import tempfile
import unicodedata

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

MAX_BYTES = 10 * 1024 * 1024
SINONIMOS = {
    'nombre': ['NOMBRE', 'NOMBRE JUGADOR', 'NOMBRE DORSAL', 'DORSAL'],
    'talla': ['TALLA'],
    'numero': ['NUMERO', 'NÚMERO'],
}
ORDEN = ['nombre', 'talla', 'numero']
ENCABEZADO = 'NOMBRE\tTALLA\tNÚMERO\tDISEÑO\tGÉNERO'
EXT = {'.xlsx', '.xlsm', '.docx', '.pdf', '.jpg', '.jpeg', '.png'}

router = APIRouter(prefix='/api/listado', tags=['listado'])
_puede = lambda usuario: False
_auth = None


def configurar(puede, auth) -> None:
    global _puede, _auth
    _puede, _auth = puede, auth


def _norm(texto) -> str:
    t = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'\s+', ' ', t.replace('°', ' ').replace('º', ' ')).strip().upper()


def _campo(celda) -> str | None:
    import difflib
    n = _norm(celda)
    if not n or len(n) < 2:
        return None
    mapa = {}
    for campo, sins in SINONIMOS.items():
        for x in sins:
            mapa[_norm(x)] = campo
    if n in mapa:
        return mapa[n]
    cercano = difflib.get_close_matches(n, list(mapa.keys()), n=1, cutoff=0.78)   # tolera pequeños errores del OCR
    return mapa[cercano[0]] if cercano else None


def _filas_a_texto(filas: list[list]) -> str:
    """Busca la fila de encabezados y devuelve las filas siguientes en el formato del listado:
    NOMBRE, TALLA, NÚMERO, DISEÑO (1 a 4, la columna marcada) y GÉNERO (M o F, la columna MASC o FEM marcada)."""
    for i, fila in enumerate(filas[:30]):
        mapa = {}
        for j, celda in enumerate(fila):
            c = _campo(celda)
            if c and c not in mapa.values():
                mapa[j] = c
        if 'nombre' in mapa.values() and len(mapa) >= 3:
            masc = [j for j, celda in enumerate(fila) if _sin_acentos(celda) == 'MASC']
            fem = [j for j, celda in enumerate(fila) if _sin_acentos(celda) == 'FEM']
            disenos = {}
            for j, celda in enumerate(fila):
                m = re.fullmatch(r'(?:DISENO|D)\s*(\d{1,2})', _sin_acentos(celda))   # DISEÑO 1 … DISEÑO 20, o D1 … D20
                if m:
                    disenos[j] = int(m.group(1))
            return _armar(filas, i, mapa, masc, fem, disenos)
    # ninguna regla reconoce el formato: la IA (local, en el VPS) propone las columnas
    propuesta = _ia_columnas(filas)
    if propuesta:
        return _armar(filas, propuesta['fila'], propuesta['mapa'], propuesta['masc'], propuesta['fem'], propuesta['disenos'])
    raise ValueError('No encontré una fila de encabezados con NOMBRE, TALLA, NÚMERO, DISEÑO, GÉNERO u OBSERVACIÓN.')


def _armar(filas: list[list], i: int, mapa: dict, masc: list, fem: list, disenos: dict) -> str:
    """Las filas de datos después del encabezado, en el formato del listado."""
    if True:
        if True:
            salida = [ENCABEZADO]
            for datos in filas[i + 1:]:
                reg = {c: ('' if j >= len(datos) or datos[j] is None else str(datos[j]).strip()) for j, c in mapa.items()}
                # Conserva la fila si trae talla o número aunque no tenga nombre (p. ej. listados sin nombres de jugador)
                if not (reg.get('nombre') or reg.get('talla') or reg.get('numero')):
                    continue
                marcada = lambda cols: any(j < len(datos) and str(datos[j] or '').strip() for j in cols)
                genero = 'MASC' if marcada(masc) else ('FEM' if marcada(fem) else '')
                diseno = next((str(n) for j, n in sorted(disenos.items()) if j < len(datos) and str(datos[j] or '').strip()), '')
                salida.append('\t'.join([reg.get('nombre', ''), reg.get('talla', ''), reg.get('numero', ''), diseno, genero]))
            return '\n'.join(salida)


OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434').rstrip('/')
LECTOR_IA_MODELO = os.getenv('LECTOR_IA_MODELO', 'qwen2.5:1.5b')


def _etiqueta_por_texto(texto: str) -> str:
    """Reglas por palabras clave: entienden la mayoría de los encabezados sin IA."""
    u = _sin_acentos(texto)
    if re.search(r'PROYECTO|CLIENTE|COMERCIAL|FECHA|ENTREGA|LINEA|CANTIDAD|REFERENCIA|VENDEDOR|OBSERV', u):
        return 'OTRO'
    if 'MASC' in u:
        return 'MASC'
    if re.search(r'\bFEM', u):
        return 'FEM'
    if re.search(r'DISEN|^D\s*\d', u):
        return 'DISENO'
    if re.search(r'NUM|DORSAL|^N\s*[°ºO.]', u) and 'NOMBRE' not in u:
        return 'NUMERO'
    if re.search(r'NOMBRE|JUGADOR', u):
        return 'NOMBRE'
    if 'TALLA' in u:
        return 'TALLA'
    return 'OTRO'


_ETIQUETAS = {'NOMBRE', 'TALLA', 'NUMERO', 'MASC', 'FEM', 'DISENO', 'OTRO'}


def _ia_columnas(filas: list[list]) -> dict | None:
    """Clasifica los encabezados de la hoja. Primero reglas por palabras clave; el modelo local (Ollama en el VPS)
    solo decide los encabezados que las reglas no entienden. Los números de columna los calcula el sistema.
    Sin IA disponible y sin NOMBRE reconocible devuelve None."""
    import json
    import urllib.request
    fila_i, encabezados = None, None
    for i, fila in enumerate(filas[:40]):
        textos = [str(c).strip() if c is not None else '' for c in fila]
        if sum(1 for t in textos if t and not re.fullmatch(r'[\d.,\s]+', t)) < 3:
            continue
        etiq = [_etiqueta_por_texto(t) for t in textos if t]
        if 'NOMBRE' in etiq and ('TALLA' in etiq or 'NUMERO' in etiq):
            fila_i, encabezados = i, textos
            break
    if encabezados is None:
        return None
    columnas = [(j, t) for j, t in enumerate(encabezados) if t]
    etiquetas = {j: _etiqueta_por_texto(t) for j, t in columnas}
    ia_ids = set()
    dudosas = [(j, t) for j, t in columnas if etiquetas[j] == 'OTRO']
    if dudosas:
        lista = '\n'.join(f'{j}: {t}' for j, t in dudosas)
        prompt = ('Clasifica estos encabezados de un pedido de uniformes. Etiquetas: NOMBRE (jugador), TALLA, NUMERO (número o dorsal), '
                  'MASC, FEM, DISENO, OTRO. Ejemplo de respuesta: {"3": "NUMERO", "7": "OTRO"}. Responde solo ese JSON.\n' + lista)
        cuerpo = json.dumps({'model': LECTOR_IA_MODELO, 'prompt': prompt, 'stream': False, 'format': 'json', 'options': {'temperature': 0}}).encode('utf-8')
        try:
            req = urllib.request.Request(OLLAMA_URL + '/api/generate', data=cuerpo, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=150) as r:
                crudo = json.loads(json.loads(r.read().decode('utf-8')).get('response') or '{}')
        except Exception:   # noqa: BLE001 — sin IA, esas columnas quedan como OTRO
            crudo = {}
        if isinstance(crudo, dict) and isinstance(crudo.get('encabezados'), list):
            pares = [(str(x.get('clave')), str(x.get('valor'))) for x in crudo['encabezados'] if isinstance(x, dict)]
        elif isinstance(crudo, dict):
            pares = [(str(k), str(v)) for k, v in crudo.items() if isinstance(v, str)]
        else:
            pares = []
        for k, v in pares:
            if k.isdigit() and int(k) in etiquetas and etiquetas[int(k)] == 'OTRO':
                etiqueta = _sin_acentos(v).replace(' ', '')
                if etiqueta in _ETIQUETAS:
                    etiquetas[int(k)] = etiqueta
                    ia_ids.add(int(k))
    mapa, masc, fem, disenos = {}, [], [], {}
    # primero las columnas que entienden las reglas; la IA solo llena lo que quede libre
    for j, t in sorted(columnas, key=lambda jt: jt[0] in ia_ids):
        e = etiquetas[j]
        if e in ('NOMBRE', 'TALLA', 'NUMERO') and e.lower() not in mapa.values():
            mapa[j] = e.lower()
        elif e == 'MASC':
            masc.append(j)
        elif e == 'FEM':
            fem.append(j)
        elif e == 'DISENO':
            m = re.search(r'(\d{1,2})', t)
            if m:
                disenos[j] = int(m.group(1))
    if 'nombre' not in mapa.values():
        return None
    return {'fila': fila_i, 'mapa': mapa, 'masc': masc, 'fem': fem, 'disenos': disenos}

def _excel(data: bytes) -> list[list[list]]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    # Solo la pestaña activa (la que estaba abierta al guardar el Excel)
    hoja = wb.active
    return [(hoja.title, [list(r) for r in hoja.iter_rows(values_only=True)])]


def _sin_acentos(texto) -> str:
    t = unicodedata.normalize('NFKD', str(texto or ''))
    return ''.join(ch for ch in t if not unicodedata.combining(ch)).upper().strip()


def _columna_cantidad(filas: list[list]):
    """Indice de la columna Cantidad y de la primera fila de datos, si es una orden de compra por productos."""
    for i, fila in enumerate(filas[:40]):
        celdas = [_sin_acentos(c) for c in fila]
        if any('PRODUCTO' in c for c in celdas):
            for j, c in enumerate(celdas):
                if c.startswith('CANTIDAD'):
                    return j, i + 1
    return None, None


def _es_orden(filas: list[list]) -> bool:
    # Un listado con columna NOMBRE de persona no es orden de compra
    if any(_sin_acentos(c) == 'NOMBRE' for f in filas[:40] for c in f):
        return False
    return _columna_cantidad(filas)[0] is not None


def _orden_a_texto(filas: list[list]) -> str:
    """Orden de compra por productos -> filas del listado, una por unidad.
    Un producto con renglones «Talla X  Numero = a,b,c»: una fila por número (o por unidad si no hay números).
    Un producto sin renglones de talla: sus unidades salen sin talla ni número."""
    cant_col, inicio = _columna_cantidad(filas)
    salida = [ENCABEZADO]
    producto = None      # {'obs', 'genero', 'cant', 'con_tallas'}
    def cerrar():
        if producto and not producto['con_tallas']:
            pass   # producto sin tallas: no hay talla ni número que cargar
    for fila in filas[inicio:]:
        if not fila:
            continue
        nombre = next((str(c).strip() for c in fila[1:4] if isinstance(c, str) and c.strip()), '')
        cant = fila[cant_col] if cant_col < len(fila) else None
        if not nombre or not isinstance(cant, (int, float)):
            continue
        texto = _sin_acentos(nombre)
        if texto.startswith('TALLA'):
            if producto is None:
                continue
            producto['con_tallas'] = True
            m = re.match(r'TALLA\s+([A-Z0-9]+)', texto)
            talla = m.group(1) if m else nombre
            mn = re.search(r'NUMERO\s*=?\s*(.*)$', texto)
            numeros = [x.strip() for x in mn.group(1).split(',') if x.strip()] if mn else []
            # Una fila por número; si la cantidad pedida es mayor, las unidades restantes van sin número
            for x in numeros:
                salida.append('\t'.join(['', talla, x]))
            for _ in range(max(0, int(cant) - len(numeros))):
                salida.append('\t'.join(['', talla, '']))
            continue
        cerrar()
        producto = {
            'obs': nombre.upper(),
            'genero': 'F' if 'FEMENINO' in texto else ('M' if 'MASCULINO' in texto else ''),
            'cant': int(cant),
            'con_tallas': False,
        }
    cerrar()
    return '\n'.join(salida)


def _word(data: bytes) -> list[list]:
    import docx
    doc = docx.Document(io.BytesIO(data))
    for tabla in doc.tables:
        return [[c.text for c in fila.cells] for fila in tabla.rows]
    raise ValueError('El Word no tiene tablas con el listado.')


def _pdf(data: bytes) -> list[list]:
    import pdfplumber
    filas = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for pagina in pdf.pages:
            for tabla in pagina.extract_tables() or []:
                filas.extend(tabla)
    if not filas:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            texto = '\n'.join((p.extract_text() or '') for p in pdf.pages)
        filas = [re.split(r'\t|\s{2,}', l.strip()) for l in texto.splitlines() if l.strip()]
    return filas


def _imagen_lineas(data: bytes, ext: str) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, 'entrada' + ext)
        with open(ruta, 'wb') as f:
            f.write(data)
        res = subprocess.run(['tesseract', ruta, 'stdout', '--psm', '6'], capture_output=True, text=True, timeout=120)
        if res.returncode != 0:
            raise ValueError('No pude leer la imagen (OCR).')
    return [l for l in res.stdout.splitlines() if l.strip()]


def _imagen(data: bytes, ext: str) -> list[list]:
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, 'entrada' + ext)
        with open(ruta, 'wb') as f:
            f.write(data)
        res = subprocess.run(['tesseract', ruta, 'stdout', '--psm', '6'], capture_output=True, text=True, timeout=120)
        if res.returncode != 0:
            raise ValueError('No pude leer la imagen (OCR).')
    return [re.split(r'\t|\s{2,}', l.strip()) for l in res.stdout.splitlines() if l.strip()]


def _imagen_tabla(data: bytes, ext: str) -> str:
    """Imagen: el OCR da la posición de cada palabra; cada palabra cae en la columna cuyo encabezado está a su izquierda."""
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, 'entrada' + ext)
        with open(ruta, 'wb') as f:
            f.write(data)
        res = subprocess.run(['tesseract', ruta, 'stdout', '--psm', '6', 'tsv'], capture_output=True, text=True, timeout=120)
        if res.returncode != 0:
            raise ValueError('No pude leer la imagen (OCR).')
    lineas: dict = {}
    for fila in res.stdout.splitlines()[1:]:
        p = fila.split('	')
        if len(p) < 12 or p[0] != '5' or not p[11].strip():
            continue
        clave = (p[2], p[3], p[4])
        lineas.setdefault(clave, []).append((int(float(p[6])), p[11].strip()))
    ordenadas = [sorted(v) for k, v in sorted(lineas.items(), key=lambda kv: (int(kv[0][0]), int(kv[0][1]), int(kv[0][2])))]
    anclas = None
    salida = [ENCABEZADO]
    for palabras in ordenadas:
        if anclas is None:
            mapa = {}
            for izq, txt in palabras:
                c = _campo(txt)
                if c and c not in mapa:
                    mapa[c] = izq
            if 'nombre' in mapa and len(mapa) >= 3:
                anclas = sorted(mapa.items(), key=lambda kv: kv[1])
            continue
        celdas = {c: [] for c in ORDEN}
        for izq, txt in palabras:
            elegido = anclas[0][0]
            for c, x in anclas:
                if x <= izq + 10:
                    elegido = c
            celdas[elegido].append(txt)
        if not celdas['nombre']:
            continue
        salida.append('	'.join(' '.join(celdas[c]) for c in ORDEN))
    if anclas is None:
        raise ValueError('No encontré una fila de encabezados con NOMBRE, TALLA, NÚMERO, DISEÑO, GÉNERO u OBSERVACIÓN.')
    return '\n'.join(salida)


def pestanas_xlsx(data: bytes) -> dict:
    """Texto del listado de CADA pestaña del libro, por nombre de pestaña (la pestaña es la referencia).
    Las pestañas sin datos reconocibles se omiten. Así el mismo Excel puede cargar varias referencias."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    salida = {}
    for hoja in wb.worksheets:
        filas = [list(r) for r in hoja.iter_rows(values_only=True)]
        try:
            texto = _orden_a_texto(filas) if _es_orden(filas) else _filas_a_texto(filas)
        except ValueError:
            continue
        salida[hoja.title] = texto
    return salida


def _libro_a_texto(pestanas: list[list[list]]) -> str:
    """Lee todas las pestañas del libro. Cada una puede ser una orden de compra o una tabla con encabezados;
    las pestañas sin datos reconocibles se omiten. Las filas se juntan bajo un solo encabezado."""
    lineas, primer_error = [], None
    for titulo, filas in pestanas:
        try:
            if _es_orden(filas):
                texto = _orden_a_texto(filas)
            else:
                texto = _filas_a_texto(filas)
        except ValueError as e:
            primer_error = primer_error or ValueError('En la pestaña «' + titulo + '»: ' + str(e))
            continue
        lineas.extend(texto.split('\n')[1:])   # sin el encabezado de cada pestaña
    if not lineas:
        raise primer_error or ValueError('No encontré datos de listado en el archivo.')
    return '\n'.join([ENCABEZADO] + [l for l in lineas if l.strip()])


def leer(nombre: str, data: bytes) -> str:
    ext = os.path.splitext(nombre.lower())[1]
    if ext not in EXT:
        raise ValueError('Tipo de archivo no permitido. Usa Excel, Word, PDF, JPG o PNG.')
    if len(data) > MAX_BYTES:
        raise ValueError('El archivo pesa más de 10 MB.')
    if ext in ('.xlsx', '.xlsm'):
        return _libro_a_texto(_excel(data))
    elif ext == '.docx':
        filas = _word(data)
    elif ext == '.pdf':
        filas = _pdf(data)
    else:
        return _imagen_tabla(data, ext)
    return _filas_a_texto(filas)


@router.post('/leer-archivo')
async def leer_archivo(request: Request, archivo: UploadFile = File(...)):
    usuario = str(_auth(request) or '') if _auth else ''
    if not _puede(usuario):
        raise HTTPException(403, 'Solo para el equipo comercial')
    data = await archivo.read()
    try:
        texto = await asyncio.to_thread(leer, archivo.filename or '', data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    lineas = texto.count('\n')
    pestanas = {}
    if os.path.splitext((archivo.filename or '').lower())[1] in ('.xlsx', '.xlsm'):
        try:
            pestanas = pestanas_xlsx(data)
        except Exception:   # noqa: BLE001 — si una pestaña no se puede leer, queda la pestaña activa
            pestanas = {}
    return {'texto': texto, 'filas': max(0, lineas), 'pestanas': pestanas}
