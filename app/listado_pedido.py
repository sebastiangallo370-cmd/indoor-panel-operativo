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

MAX_DISENOS = 20                      # la plantilla acepta hasta 20 diseños (AG3 «N° de diseños a usar (1-20)»); en la lista de personas solo hay columnas DISEÑO 1 a 6
COLUMNAS_DISENO = 6
GENEROS = ('MASC', 'FEM')
TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']   # lista desplegable de TALLA de la plantilla de Indoor
LINEAS = ['COPA', 'PLUS', 'MAQUILA', 'PREMIUM', 'ESTANDAR']                                             # lista desplegable de LINEA DE PRODUCTO
TALLAS_CONOCIDAS = {'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '4', '6', '8', '10', '12', '14', '16'}


# MISMO patrón que pedidos_legacy.REF_HOJA_RE: el programar pedido solo toma como hoja de producto los nombres con este formato (A100CA02, FUT01 NO).
_REF_BASE = r'[A-Z]\d{2,}(?:[A-Z]{1,6}\d{1,3}[A-Z]?)?'
REF_PRODUCCION_RE = re.compile(r'^(?!BASE_DATOS$|REFERENCIA$).+$')   # cualquier tipo de referencia; solo se excluyen hojas auxiliares


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
    # la vista y la página también: sin esto la copia perdía el zoom (70 %), las líneas de cuadrícula ocultas y la configuración de impresión,
    # y las pestañas de una misma orden se veían distintas (la primera con el formato de la plantilla y las demás no)
    for atributo in ('sheet_format', 'sheet_properties', 'page_setup', 'page_margins', 'print_options', 'HeaderFooter'):
        try:
            setattr(nueva, atributo, copy(getattr(base, atributo)))
        except Exception:  # noqa: BLE001 - un atributo que no se deje copiar no debe romper el listado
            pass
    try:   # la vista (zoom, cuadrícula, paneles) es una propiedad sin asignación directa: se copia su contenido
        nueva.views.sheetView[0] = copy(base.views.sheetView[0])
        nueva.views.sheetView[0].tabSelected = False   # solo la primera hoja queda seleccionada
    except Exception:  # noqa: BLE001
        pass


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
    fila, maximo = 8, 1
    for f in sorted(g['filas'], key=lambda x: int(x.get('diseno') or 1)):   # como la skill: cada diseño en su propio bloque, D1 primero, luego D2…
        ws.cell(row=fila, column=3, value=f['nombre'] or None)
        ws.cell(row=fila, column=4, value=f['talla'] or None)
        ws.cell(row=fila, column=5, value=f['numero'] or None)
        maximo = max(maximo, f['diseno'])
        obs = f['observacion']
        if f['diseno'] <= COLUMNAS_DISENO:
            ws.cell(row=fila, column=9 + f['diseno'], value='X')
        else:   # la plantilla no trae columna para el diseño 7 en adelante: se anota en OBSERVACIONES («DISEÑO 7 · …»), como en el generador anterior
            obs = f'DISEÑO {f["diseno"]}' + (f' · {obs}' if obs else '')
        if obs:
            ws.cell(row=fila, column=18, value=obs)
        ws.cell(row=fila, column=16 if f['genero'] == 'MASC' else 17, value='X')
        fila += 1
    return maximo


AGRUPAR_FAMILIAS = False   # True = como la skill: A200FUT01 y A200FUT02 en una sola pestaña


def familia(ref: str) -> str:
    """Como REPROGRAMACIONES AUTOMÁTICAS (excel_linux.family) y la skill: A200FUT01 y A200FUT02 son la familia A200FUT."""
    return re.sub(r'[-_]*\d+$', '', ref) or ref


def hojas_por_familia(grupos: list[dict]) -> list[dict]:
    """Una pestaña por familia de referencia. Nombre = la referencia sola o las referencias unidas con «-» (A200FUT01-A200FUT02), que el programar pedido
    lee como referencia compuesta. Si el nombre no cabe en 31 letras, esas referencias quedan en pestañas separadas."""
    fams: dict[str, list[dict]] = {}
    for g in grupos:   # pedido del usuario (2026-11-15): CADA referencia en su propia pestaña (ya no se juntan las de la misma familia)
        fams.setdefault(g['referencia'] if not AGRUPAR_FAMILIAS else familia(g['referencia']), []).append(g)
    hojas = []
    for gs in fams.values():
        nombre = '-'.join(g['referencia'] for g in gs)
        partes = [gs] if len(nombre) <= 31 and REF_PRODUCCION_RE.match(nombre) else [[g] for g in gs]
        for p in partes:
            filas = [f for d in range(1, MAX_DISENOS + 1) for g in p for f in g['filas'] if int(f.get('diseno') or 1) == d]
            hojas.append({'referencia': '-'.join(g['referencia'] for g in p), 'refs': [g['referencia'] for g in p], 'filas': filas,
                          'cantidad': sum(g['cantidad'] for g in p)})
    return hojas


def excel_listado(doc: dict, grupos: list[dict], plantilla: bytes, comercial: str = '', linea_producto: str = '') -> tuple[str, bytes]:
    """UN Excel con una hoja por referencia (la plantilla se copia en blanco ANTES de llenar la primera)."""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(plantilla), keep_vba=True)
    base = wb.worksheets[0]
    grupos = hojas_por_familia(grupos)
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
    # como se guarda en la carpeta de la orden: NUMEROORDEN_NOMBRE PROYECTO (CO1234_UNIFORMES 2027)
    proyecto = re.sub(r'\s+', ' ', re.sub(r'[^A-Za-z0-9\s-]', '', _sin_acentos(str(doc.get('proyecto') or '')).upper())).strip()[:60]
    return f'{pref}{numero}_{proyecto or "LISTADO"}.xlsm', buf.getvalue()


def preparar(datos: dict, plantilla_fn, comercial: str = '') -> dict:
    """Valida y arma los archivos del programar pedido: {'pdf_nombre','pdf','excel_nombre','excel','observaciones','linea'}."""
    doc = datos.get('doc') or {}
    grupos = validar(doc, datos.get('listado') or {})
    pref, numero = prefijo_numero(doc)
    linea_producto = str(datos.get('linea') or '').strip().upper()[:40]
    nombre_xlsx, xlsx = excel_listado(doc, grupos, plantilla_fn(), comercial or str(doc.get('vendedor') or ''), linea_producto)
    return {'pdf_nombre': f'{pref}{numero}.pdf', 'pdf': pdf_cotizacion(doc, grupos), 'excel_nombre': nombre_xlsx, 'excel': xlsx,
            'observaciones': str(datos.get('observaciones') or '').strip()[:5000], 'linea': linea_producto, 'grupos': grupos,
            'hoja_de': {r: h['referencia'] for h in hojas_por_familia(grupos) for r in h['refs']}}
def _color(c) -> str:
    try:
        rgb = c.rgb if c is not None else None
        if isinstance(rgb, str) and len(rgb) in (6, 8) and rgb not in ('00000000',):
            rgb = rgb[-6:]
            return '' if rgb.upper() == 'FFFFFF' and False else '#' + rgb
    except Exception:  # noqa: BLE001
        pass
    return ''


def vista_excel(ruta, max_cols: int = 48, extra: int = 2, lado_img: int = 700) -> dict:
    """El Excel tal como quedó (plantilla de Indoor + filas + mockups) en un formato que el navegador puede dibujar como una hoja de Excel:
    anchos, altos, celdas combinadas, valores, negritas, rellenos, y las imágenes con su posición. Solo lectura."""
    import base64
    from io import BytesIO
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    from PIL import Image
    wb = load_workbook(ruta, keep_vba=True)
    hojas = []
    for ws in wb.worksheets:
        ultima = 7
        for r in range(8, min(ws.max_row, 700) + 1):
            if any(ws.cell(row=r, column=c).value not in (None, '') for c in (3, 4, 5)):
                ultima = r
        filas = ultima + extra
        imagenes = []
        for im in getattr(ws, '_images', []):
            a = im.anchor
            de = getattr(a, '_from', None)
            if de is None or de.row >= filas + 40:
                continue
            hasta = getattr(a, 'to', None)
            try:
                img = Image.open(BytesIO(im._data()))
                img.thumbnail((lado_img, lado_img))
                buf = BytesIO()
                img.convert('RGB').save(buf, 'JPEG', quality=82)
                datos = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
            except Exception:  # noqa: BLE001
                continue
            ext = getattr(a, 'ext', None)
            imagenes.append({'c1': de.col + 1, 'r1': de.row + 1, 'dx': int((de.colOff or 0) / 9525), 'dy': int((de.rowOff or 0) / 9525),
                             'c2': (hasta.col + 1) if hasta else None, 'r2': (hasta.row + 1) if hasta else None,
                             'w': int(ext.width / 9525) if ext is not None and getattr(ext, 'width', None) else None,
                             'h': int(ext.height / 9525) if ext is not None and getattr(ext, 'height', None) else None, 'src': datos})
        cols_usadas = 1
        celdas = []
        for fila in ws.iter_rows(min_row=1, max_row=filas, max_col=max_cols):
            for c in fila:
                v = c.value
                relleno = _color(c.fill.fgColor) if c.fill is not None and c.fill.fill_type == 'solid' else ''
                if v in (None, '') and not relleno:
                    continue
                cols_usadas = max(cols_usadas, c.column)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    texto = f'{v:g}' if isinstance(v, float) else str(v)
                elif hasattr(v, 'strftime'):
                    texto = v.strftime('%Y-%m-%d')
                else:
                    texto = '' if v is None else str(v)
                if texto.startswith('='):
                    texto = ''
                celdas.append({'r': c.row, 'c': c.column, 't': texto, 'b': bool(c.font and c.font.b), 'f': relleno,
                               'k': _color(c.font.color) if c.font is not None and c.font.color is not None else '',
                               'h': (c.alignment.horizontal or '') if c.alignment is not None else '', 'z': float(c.font.sz or 11) if c.font is not None else 11.0})
        for im in imagenes:
            cols_usadas = max(cols_usadas, im['c2'] or im['c1'])
        n_cols = min(max_cols, cols_usadas + 1)
        anchos = [round((ws.column_dimensions[get_column_letter(i)].width or 8.43) if get_column_letter(i) in ws.column_dimensions else 8.43, 2) for i in range(1, n_cols + 1)]
        altos = [round(ws.row_dimensions[r].height or 15, 2) if r in ws.row_dimensions else 15.0 for r in range(1, filas + 1)]
        combinadas = []
        for m in ws.merged_cells.ranges:
            if m.min_row <= filas and m.min_col <= n_cols:
                combinadas.append([m.min_row, m.min_col, min(m.max_row, filas), min(m.max_col, n_cols)])
        hojas.append({'nombre': ws.title, 'filas': filas, 'cols': n_cols, 'primera_dato': 8, 'ultima_dato': ultima, 'anchos': anchos, 'altos': altos,
                      'combinadas': combinadas, 'celdas': [x for x in celdas if x['c'] <= n_cols], 'imagenes': imagenes})
    return {'hojas': hojas}


def preparar_en_proceso(datos: dict, plantilla: bytes, comercial: str = '') -> dict:
    """Igual que `preparar`, pero pensado para correr en OTRO proceso (arma el Excel con openpyxl, que es lo más pesado): así varios comerciales programando a la vez
    usan todos los núcleos y no se frenan unos a otros ni frenan al resto del panel."""
    return preparar(datos, lambda: plantilla, comercial)


def calentar() -> int:
    """No hace nada: sirve para que el proceso trabajador ya esté arrancado (y con openpyxl cargado) cuando llegue el primer pedido."""
    import openpyxl  # noqa: F401
    return 1
