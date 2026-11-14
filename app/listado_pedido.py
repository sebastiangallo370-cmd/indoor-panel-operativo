"""LISTADO DEL PEDIDO (COMERCIALES → EMPEZAR PEDIDO): después de crear la cotización en Effi, el comercial llena el listado (nombre, talla, número, diseño, género y
observación de cada prenda) y adjunta los mockups. Este módulo arma, con eso, lo que el programar pedido de siempre (`POST /procesar/pedido`) necesita:
  1. un PDF de la cotización con el MISMO formato de texto que lee `pedidos_legacy.extraer_info_pdf` (cliente, vendedor, proyecto en «Garantía», número, fechas, una línea
     por concepto/diseño/género con su D1./MASC y, debajo, una línea por prenda NOMBRE-TALLA-NÚMERO, y los totales);
  2. el Excel del listado con la plantilla de Indoor (una hoja por referencia, la misma que usa club.py).
Nada de esto toca Effi: la cotización ya se creó. Aquí solo se valida y se genera."""
from __future__ import annotations

import io
import re
import unicodedata
from datetime import date

MAX_DISENOS = 6                       # la plantilla trae las columnas DISEÑO 1 a 6
GENEROS = ('MASC', 'FEM')
TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']   # lista desplegable de TALLA de la plantilla de Indoor
LINEAS = ['COPA', 'PLUS', 'MAQUILA', 'PREMIUM', 'ESTANDAR']                                             # lista desplegable de LINEA DE PRODUCTO
TALLAS_CONOCIDAS = {'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '4', '6', '8', '10', '12', '14', '16'}


# MISMO patrón que pedidos_legacy.REF_HOJA_RE: el programar pedido solo toma como hoja de producto los nombres con este formato (A100CA02, FUT01 NO).
_REF_BASE = r'[A-Z]\d{2,}(?:[A-Z]{1,6}\d{1,3}[A-Z]?)?'
REF_PRODUCCION_RE = re.compile(r'^(?:' + _REF_BASE + r'(?:[-+/]' + _REF_BASE + r')*|[A-Z]-[A-Z0-9-]*\d[A-Z0-9-]*)$')


def _sin_acentos(t) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if unicodedata.category(c) != 'Mn')


def _token(t, largo: int = 10) -> str:
    """Un segmento que el programar pedido sabe leer: letras y números, mayúsculas, máximo 10."""
    return re.sub(r'[^A-Z0-9]', '', _sin_acentos(t).upper())[:largo]


def _dinero(n) -> str:
    return '$' + f'{int(round(float(n or 0))):,}'.replace(',', '.')


def _entero(v, campo: str) -> int:
    try:
        f = float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        raise ValueError(f'{campo} no es un número')
    if f != int(f) or f <= 0:
        raise ValueError(f'{campo} debe ser un entero mayor que cero')
    return int(f)


def referencia_de(c: dict) -> str:
    return re.sub(r'[\\/*?:\[\]]', '', str(c.get('referencia') or '').strip().upper())[:31]


def agrupar(conceptos: list[dict]) -> list[dict]:
    """Una entrada por referencia (si la misma referencia va en dos conceptos, sus cantidades se suman: el listado es uno solo)."""
    out: dict[str, dict] = {}
    for i, c in enumerate(conceptos, 1):
        ref = referencia_de(c)
        if not ref:
            raise ValueError(f'El concepto {i} no tiene referencia')
        cant = _entero(c.get('cantidad'), f'La cantidad de {ref}')
        g = out.setdefault(ref, {'referencia': ref, 'descripcion': str(c.get('descripcion') or ref), 'cantidad': 0, 'precio': float(c.get('precio') or 0)})
        g['cantidad'] += cant
    return list(out.values())


def validar(doc: dict, listado: dict) -> list[dict]:
    """Devuelve los grupos por referencia con sus filas ya normalizadas. Lanza ValueError con TODOS los problemas (uno por línea) para que el comercial los corrija juntos."""
    errores: list[str] = []
    grupos = agrupar(doc.get('conceptos') or [])
    if not grupos:
        raise ValueError('La cotización no tiene conceptos')
    for campo, nombre in (('proyecto', 'el nombre del proyecto'), ):
        if not str(doc.get(campo) or '').strip():
            errores.append(f'Falta {nombre}')
    if not str((doc.get('cliente') or {}).get('nombre') or '').strip():
        errores.append('Falta el cliente')
    n_disenos = max(1, min(int(doc.get('disenos') or 1), MAX_DISENOS))
    for g in grupos:
        filas = listado.get(g['referencia']) or []
        if not REF_PRODUCCION_RE.match(g['referencia']):
            errores.append(f'{g["referencia"]}: no tiene formato de referencia de producción (por ejemplo A100CA02); el programar pedido no la tomaría. Revisa el artículo en Effi')
        norm = []
        for k, f in enumerate(filas, 1):
            talla = str(f.get('talla') or '').strip().upper()
            genero = str(f.get('genero') or '').strip().upper()
            try:
                diseno = int(f.get('diseno') or 1)
            except (TypeError, ValueError):
                diseno = 0
            if not talla:
                errores.append(f'{g["referencia"]} · fila {k}: falta la talla')
            if genero not in GENEROS:
                errores.append(f'{g["referencia"]} · fila {k}: elige el género (MASC o FEM)')
            if not 1 <= diseno <= n_disenos:
                errores.append(f'{g["referencia"]} · fila {k}: el diseño debe estar entre D1 y D{n_disenos}')
            norm.append({'nombre': str(f.get('nombre') or '').strip(), 'talla': talla, 'numero': str(f.get('numero') or '').strip(), 'diseno': diseno, 'genero': genero,
                         'observacion': str(f.get('observacion') or '').strip()})
        if len(norm) != g['cantidad']:
            dif = g['cantidad'] - len(norm)
            errores.append(f'{g["referencia"]}: la cotización dice {g["cantidad"]} prendas y el listado tiene {len(norm)} ({"faltan " + str(dif) if dif > 0 else "sobran " + str(-dif)})')
        g['filas'] = norm
    if errores:
        raise ValueError('\n'.join(errores[:40]) + (f'\n…y {len(errores) - 40} más' if len(errores) > 40 else ''))
    return grupos


def validar_mockups(grupos: list[dict], doc: dict, presentes: set) -> None:
    """El programar pedido inserta cada imagen en la hoja de SU referencia y en el diseño que dice el nombre (A100CA02_D1.png): hace falta una imagen por referencia y por diseño."""
    n = max(1, min(int(doc.get('disenos') or 1), MAX_DISENOS))
    faltan = [f'{g["referencia"]} · D{d}' for g in grupos for d in range(1, n + 1) if (g['referencia'], d) not in presentes]
    if faltan:
        raise ValueError('Falta el mockup de: ' + ', '.join(faltan[:12]) + (f' y {len(faltan) - 12} más' if len(faltan) > 12 else ''))


def prefijo_numero(doc: dict) -> tuple[str, str]:
    """('CO', '6400'): el programar pedido saca el tipo y el número del nombre del archivo."""
    numero = re.sub(r'\D', '', str(doc.get('numero') or ''))
    pref = re.sub(r'[^A-Z]', '', str(doc.get('prefijo') or '').upper()) or ('RM' if doc.get('tipo') == 'remision' else 'CO')
    if pref not in ('CO', 'RM'):
        pref = 'RM' if doc.get('tipo') == 'remision' else 'CO'
    if not numero:
        raise ValueError('Falta el número de la cotización')
    return pref, numero


def _linea_talla(f: dict) -> str:
    """Una prenda como la escribe Effi bajo el concepto: NOMBRE-TALLA-NÚMERO (cada segmento, una sola palabra de hasta 10 letras/números)."""
    nombre, talla, numero = _token(f['nombre']), _token(f['talla']) or 'X', _token(f['numero'])
    if nombre and numero:
        return f'{nombre}-{talla}-{numero}'
    if nombre:
        return f'{nombre}-{talla}'
    if numero and talla in TALLAS_CONOCIDAS:
        return f'{talla}-{numero}'
    return talla


def pdf_cotizacion(doc: dict, grupos: list[dict]) -> bytes:
    """PDF de la cotización con el formato de texto de Effi (lo lee pedidos_legacy.extraer_info_pdf). Una línea por concepto, diseño y género."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    pref, numero = prefijo_numero(doc)
    es_rem = pref == 'RM'
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _, alto = A4
    estado = {'y': alto - 40}

    def linea(texto: str, size: int = 9, bold: bool = False, dy: int = 13) -> None:
        if estado['y'] < 48:
            c.showPage(); estado['y'] = alto - 40
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        c.drawString(36, estado['y'], str(texto))
        estado['y'] -= dy

    cli = doc.get('cliente') or {}
    nombre_cli = re.sub(r'\s+', ' ', str(cli.get('nombre') or '').replace('.', '')).strip()   # el lector corta el nombre en el primer punto («S.A.S.»)
    doc_cli = re.sub(r'[^\w -]', '', str(cli.get('documento') or ''))
    hoy = date.today().isoformat()
    linea('INDOOR SPORT SAS', 13, True, 18)
    linea('REMISIÓN DE VENTA' if es_rem else 'COTIZACIÓN', 11, True, 16)
    linea(f'No. {numero}', 11, True, 16)
    linea(f'Creación: {str(doc.get("fecha_creacion") or hoy)[:10]}')
    linea(f'Entrega: {str(doc.get("fecha_entrega") or hoy)[:10]}')
    linea(f'Cliente: {nombre_cli} CC: {doc_cli}')
    linea(f'Vendedor: {str(doc.get("vendedor") or "").strip()}')
    linea(f'Garantía: {str(doc.get("proyecto") or "").strip()}', dy=18)
    if doc.get('observacion'):
        linea(f'Observación: {str(doc["observacion"])[:150]}', dy=16)
    linea('ITEM REF DESCRIPCION CANT PRECIO DESCUENTO IMPUESTOS TOTAL NETO', 8, True, 14)
    item, bruto_t = 0, 0.0
    for g in grupos:
        base = re.sub(r'\bD\d+\.', '', re.sub(r'\b(MASCULINO|MASC|MAC|FEMENINO|FEM)\b', '', g['descripcion'], flags=re.I))
        base = re.sub(r'\s+', ' ', base).strip().upper()[:60]
        combos: dict[tuple[int, str], list[dict]] = {}
        for f in g['filas']:
            combos.setdefault((f['diseno'], f['genero']), []).append(f)
        for (d, gen), filas in sorted(combos.items()):
            item += 1
            cant = len(filas)
            bruto = cant * g['precio']
            bruto_t += bruto
            linea(f'{item} {g["referencia"]} {base} D{d}. {gen} {cant} {_dinero(g["precio"])} {_dinero(bruto)} $0 {_dinero(bruto)}')
            for f in filas:
                linea(_linea_talla(f), 8, False, 11)
    linea('', dy=6)
    linea(f'SUBTOTAL {_dinero(doc.get("subtotal") if doc.get("subtotal") is not None else bruto_t)}', 10, True, 15)
    linea(f'TOTAL NETO {_dinero(doc.get("total") if doc.get("total") is not None else bruto_t)}', 10, True, 15)
    c.showPage()
    c.save()
    return buf.getvalue()


def _clonar_adornos(base, nueva) -> None:
    """copy_worksheet copia celdas, estilos y combinadas, pero NO el logo, las listas desplegables (talla, línea) ni el formato condicional: se copian aparte para que todas las hojas queden como la plantilla."""
    from copy import copy
    from openpyxl.drawing.image import Image
    for img in getattr(base, '_images', []):
        try:
            img.ref.seek(0); crudo = img.ref.read(); img.ref.seek(0)   # sin llamar a img._data(): cierra el archivo y la hoja original ya no podría guardarse
        except (ValueError, AttributeError):
            continue
        nuevo = Image(io.BytesIO(crudo))
        nuevo.anchor = copy(img.anchor)
        nueva.add_image(nuevo)
    for dv in base.data_validations.dataValidation:
        nueva.add_data_validation(copy(dv))
    for rango in base.conditional_formatting:
        for regla in rango.rules:
            nueva.conditional_formatting.add(str(rango.sqref), copy(regla))
    nueva.protection = copy(base.protection)


def _llenar_hoja(ws, doc: dict, g: dict, comercial: str, linea_producto: str) -> int:
    """Mismo mapa de celdas que club.construir_excels: cabecera en J2:J4, y por prenda NOMBRE(C), TALLA(D), NÚMERO(E), X en DISEÑO (J..O), MASC (P) / FEM (Q), OBSERVACIONES (R)."""
    ws.title = referencia_de({'referencia': g['referencia']}) or 'REFERENCIA'
    ws['J2'] = str((doc.get('cliente') or {}).get('nombre') or '')
    ws['J3'] = str(doc.get('proyecto') or '')
    ws['J4'] = comercial
    try:
        ws['J5'] = date.fromisoformat(str(doc.get('fecha_entrega') or '')[:10])   # «FECHA DE ENTREGA» de la plantilla
    except ValueError:
        pass
    if linea_producto:
        ws['J6'] = linea_producto
    ws['P2'] = 'COTIZACIÓN'
    ws['P3'] = '%s%s' % prefijo_numero(doc)
    fila, maximo = 8, 1
    for f in g['filas']:
        ws.cell(row=fila, column=3, value=f['nombre'] or None)
        ws.cell(row=fila, column=4, value=f['talla'] or None)
        ws.cell(row=fila, column=5, value=f['numero'] or None)
        maximo = max(maximo, f['diseno'])
        ws.cell(row=fila, column=9 + f['diseno'], value='X')
        if f['observacion']:
            ws.cell(row=fila, column=18, value=f['observacion'])
        ws.cell(row=fila, column=16 if f['genero'] == 'MASC' else 17, value='X')
        fila += 1
    return maximo


def excel_listado(doc: dict, grupos: list[dict], plantilla: bytes, comercial: str = '', linea_producto: str = '') -> tuple[str, bytes]:
    """UN Excel con una hoja por referencia (la plantilla se copia en blanco ANTES de llenar la primera)."""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(plantilla), keep_vba=True)
    base = wb.worksheets[0]
    hojas = [base]
    for _ in grupos[1:]:
        copia = wb.copy_worksheet(base)
        _clonar_adornos(base, copia)
        hojas.append(copia)
    maximo = 1
    for ws, g in zip(hojas, grupos):
        maximo = max(maximo, _llenar_hoja(ws, doc, g, comercial, linea_producto))
        try:
            ws['AG3'] = max(int(ws['AG3'].value or 1), min(maximo, MAX_DISENOS))
        except (TypeError, ValueError):
            pass
    buf = io.BytesIO()
    wb.save(buf)
    pref, numero = prefijo_numero(doc)
    cliente = re.sub(r'[^A-Za-z0-9_-]+', '_', _sin_acentos((doc.get('cliente') or {}).get('nombre') or ''))[:40].strip('_')
    return f'{pref}{numero}_{cliente or "LISTADO"}.xlsm', buf.getvalue()


def preparar(datos: dict, plantilla_fn, comercial: str = '') -> dict:
    """Valida y arma los archivos del programar pedido: {'pdf_nombre','pdf','excel_nombre','excel','observaciones','linea'}."""
    doc = datos.get('doc') or {}
    grupos = validar(doc, datos.get('listado') or {})
    pref, numero = prefijo_numero(doc)
    linea_producto = str(datos.get('linea') or '').strip().upper()[:40]
    nombre_xlsx, xlsx = excel_listado(doc, grupos, plantilla_fn(), comercial or str(doc.get('vendedor') or ''), linea_producto)
    return {'pdf_nombre': f'{pref}{numero}.pdf', 'pdf': pdf_cotizacion(doc, grupos), 'excel_nombre': nombre_xlsx, 'excel': xlsx,
            'observaciones': str(datos.get('observaciones') or '').strip()[:5000], 'linea': linea_producto, 'grupos': grupos}
