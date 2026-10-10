"""Fichas técnicas por REF: lee los libros de Excel de la carpeta FICHAS TECNICAS (un libro por familia de prenda, una hoja por REF, todas con la
plantilla personalizada de Indoor) y los convierte en datos + imágenes para mostrarlos en el módulo MOLDERIA.

La primera hoja de cada libro es la plantilla vacía de la familia: no es una ficha y se salta. Cada hoja siguiente es la ficha de una REF.
Todo se guarda ya procesado en DATOS/fichas (índice + una ficha por hoja + imágenes), así que abrir una ficha no vuelve a leer el Excel.
"""
import io
import json
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

DATOS = Path('/data/state/fichas')
_lock = threading.Lock()
estado = {'importando': False, 'progreso': '', 'actualizado': '', 'error': '', 'libros': 0, 'fichas': 0}

MAX_PX = 1400
ZONAS = ('piezas', 'mockup', 'fisica', 'insumos', 'lupa', 'otras')


def _plano(t) -> str:
    sin = ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', sin).strip().upper()


def _texto(v) -> str:
    if v is None:
        return ''
    if isinstance(v, float) and v == int(v):
        v = int(v)
    return re.sub(r'[ \t]+', ' ', str(v).replace('\r', '\n')).strip()


def _slug(t: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', _plano(t).lower()).strip('-') or 'x'


def _celdas(ws) -> dict:
    """{(fila, columna): texto} solo de las celdas con contenido."""
    datos = {}
    for fila in ws.iter_rows():
        for c in fila:
            t = _texto(c.value)
            if t:
                datos[(c.row, c.column)] = t
    return datos


def _fila(datos: dict, r: int) -> list:
    return sorted((c, t) for (rr, c), t in datos.items() if rr == r)


def _buscar(datos: dict, texto: str, col: int | None = None, desde: int = 1, hasta: int = 400, exacto: bool = False):
    """Primera celda (fila, col) cuyo texto (sin acentos) empieza por / es `texto`."""
    objetivo = _plano(texto)
    mejor = None
    for (r, c), t in datos.items():
        if r < desde or r > hasta or (col is not None and c != col):
            continue
        p = _plano(t)
        if (p == objetivo) if exacto else p.startswith(objetivo):
            if mejor is None or (r, c) < mejor:
                mejor = (r, c)
    return mejor


def _derecha(datos: dict, r: int, c: int, hasta: int = 80):
    """Texto de la primera celda con contenido a la derecha de (r, c) en la misma fila."""
    for cc in range(c + 1, hasta):
        if (r, cc) in datos:
            return datos[(r, cc)]
    return ''


def _tabla(datos: dict, fila_cab: int, hasta_fila: int, cabeceras: list, col_min: int = 1, col_max: int = 28) -> list:
    """Filas bajo una fila de cabeceras (NOMBRE, TIPO, COLOR…); cada valor se lee en la columna de su cabecera."""
    cols = {}
    for c, t in _fila(datos, fila_cab):
        if col_min <= c <= col_max and _plano(t) in cabeceras:
            cols[_plano(t)] = c
    if not cols:
        return []
    ordenadas = sorted(cols.items(), key=lambda x: x[1])
    filas = []
    for r in range(fila_cab + 1, hasta_fila):
        valores = {}
        for i, (nombre, c) in enumerate(ordenadas):
            fin = ordenadas[i + 1][1] if i + 1 < len(ordenadas) else col_max + 1
            partes = [datos[(r, cc)] for cc in range(c, fin) if (r, cc) in datos]
            valores[nombre.lower()] = ' '.join(partes)
        valores = {k: v for k, v in valores.items() if k != 'previsualizacion'}
        if not any(valores.values()):
            if filas:
                break
            continue
        filas.append(valores)
    return filas


def _tallaje(datos: dict, titulo_col: int, desde: int, hasta: int) -> dict | None:
    """Tabla de medidas (TALLA / ANCHO (X) / ALTO (Y)) que empieza en la columna `titulo_col`."""
    rt = None
    for r in range(desde, hasta):
        if _plano(datos.get((r, titulo_col), '')) == 'TALLA':
            rt = r
            break
    if rt is None:
        return None
    tallas = []
    c = titulo_col + 1
    while c < titulo_col + 16:
        if (rt, c) in datos:
            if _plano(datos[(rt, c)]) == 'TALLA':   # empieza la tabla de al lado
                break
            tallas.append((c, datos[(rt, c)]))
        elif tallas and c > tallas[-1][0] + 1:
            break
        c += 1
    medidas = {}
    for r in range(rt + 1, rt + 6):
        etiqueta = _plano(datos.get((r, titulo_col), ''))
        if etiqueta.startswith('ANCHO') or etiqueta.startswith('ALTO') or etiqueta.startswith('LARGO'):
            medidas[etiqueta.split(' ')[0].lower()] = [datos.get((r, cc), '') for cc, _ in tallas]
    if not tallas or not medidas:
        return None
    nota = ''
    for r in range(rt + 1, rt + 6):
        if _plano(datos.get((r, titulo_col), '')).startswith('NOTA'):
            nota = _derecha(datos, r, titulo_col, titulo_col + 25)
    return {'tallas': [t for _, t in tallas], **medidas, 'nota': nota}


def _hoja_a_ficha(ws) -> dict | None:
    datos = _celdas(ws)
    marca = datos.get((2, 2), '')
    if 'DESCRIPCION GENERAL' not in _plano(marca):
        return None   # no es una hoja con la plantilla de Indoor
    ficha = {'hoja': ws.title}
    # --- encabezado (filas 4 a 8)
    r = _buscar(datos, 'PRENDA', col=2, desde=3, hasta=8, exacto=True)
    ficha['prenda'] = _derecha(datos, r[0], r[1], 9) if r else ''
    r = _buscar(datos, 'REFERENCIA', desde=3, hasta=8, exacto=True)
    ficha['referencia'] = _derecha(datos, r[0], r[1], r[1] + 4) if r else ''
    nota_h = _buscar(datos, 'NOTA', col=2, desde=3, hasta=9)
    ficha['nota_prenda'] = _derecha(datos, nota_h[0], nota_h[1], 14) if nota_h else ''
    promedios = []
    for fila in range(4, 9):
        etiqueta = datos.get((fila, 15), '')
        if _plano(etiqueta).startswith('PROMEDIO'):
            vals = {}
            for c, t in _fila(datos, fila):
                if c > 15 and _plano(t) in ('MASC', 'FEME', 'FEM', 'NINO', 'NINA'):
                    v = datos.get((fila, c + 2), '') or datos.get((fila, c + 1), '')
                    vals[_plano(t).lower()] = v
            promedios.append({'nombre': etiqueta, 'valores': vals})
        elif _plano(etiqueta).startswith('NOTA') and fila > 4:
            ficha['nota_promedio'] = _derecha(datos, fila, 15, 27)
    ficha['promedios'] = promedios
    telas = []
    for fila in range(4, 12):
        t = datos.get((fila, 27), '')
        if re.fullmatch(r'M\d', t.strip().upper()):
            telas.append({'material': t.strip().upper(), 'tela': datos.get((fila, 28), '')})
    ficha['telas'] = telas
    comp = next((fila for fila in range(4, 12) if _plano(datos.get((fila, 27), '')).startswith('COMP')), None)
    ficha['composicion'] = datos.get((comp, 28), '') if comp else ''
    # --- fit y piezas
    fit = []
    for fila in range(8, 12):
        for c, t in _fila(datos, fila):
            if c < 32 and (_plano(t).startswith('FIT') or _plano(t).startswith('MOLDERIA')):
                fit.append({'titulo': t, 'nota': datos.get((fila + 1, c), '')})
    ficha['fit'] = fit
    # --- tallajes (niño / masculino / femenino): la tabla vive a la derecha, columnas AP, BA y BL en la plantilla
    tallajes = []
    fila_tit = None
    for (rr, cc), t in datos.items():
        if _plano(t).startswith('MEDIDAS TALLAJE') and cc > 36:
            fila_tit = rr
            tallajes.append((cc, t))
    for cc, titulo in sorted(tallajes):
        tabla = _tallaje(datos, cc, (fila_tit or 10) + 1, (fila_tit or 10) + 30)
        if tabla and any(v for k in ('ancho', 'alto', 'largo') for v in tabla.get(k, [])):
            ficha.setdefault('tallajes', []).append({'titulo': titulo, **tabla})
    ficha.setdefault('tallajes', [])
    # --- piezas (rótulos bajo cada imagen del fit)
    piezas = []
    for (rr, cc), t in sorted(datos.items()):
        if 11 <= rr <= 34 and cc < 31 and rr > 12 and not _plano(t).startswith(('DESCRIPCION', 'NOTA', 'FIT', 'MOLDERIA', 'INFORMACION', 'INSUMOS')) and len(t) < 40:
            if not re.fullmatch(r'\d°?', t):
                piezas.append(t)
    ficha['piezas'] = piezas[:30]
    # --- descripción numerada
    d0 = _buscar(datos, 'DESCRIPCION', col=2, desde=12, hasta=60, exacto=True)
    d1 = _buscar(datos, 'INFORMACION INSUMOS', col=2, desde=12, hasta=90)
    desc = []
    if d0 and d1:
        for rr in range(d0[0], d1[0]):
            num, txt = datos.get((rr, 5), ''), datos.get((rr, 6), '')
            if txt:
                desc.append({'n': num, 'texto': txt})
            elif num and not re.fullmatch(r'\d°?', num):
                desc.append({'n': '', 'texto': num})
    ficha['descripcion'] = desc
    # --- insumos de la confección
    i0 = _buscar(datos, 'INSUMOS', col=2, desde=(d1[0] if d1 else 30), hasta=90, exacto=True)
    c0 = _buscar(datos, 'TODO LO RELACIONADO CON CONFECCION', col=2, desde=(d1[0] if d1 else 30), hasta=120)
    ficha['insumos'] = []
    if i0 and c0:
        cab = i0[0] + 1
        ficha['insumos'] = _tabla(datos, cab, c0[0], ['NOMBRE', 'TIPO', 'COLOR', 'MEDIDA', 'CANT', 'OBSERVACION'], 2, 28)
    # --- medidas de los insumos (bloques «MEDIDA <insumo> NIÑO/MASCULINO/FEMENINO»)
    medidas_insumos = []
    if d1 and c0:
        for (rr, cc), t in sorted(datos.items()):
            if d1[0] <= rr < c0[0] and cc > 33 and _plano(t).startswith('MEDIDA '):
                tallas, medidas = [], []
                for r2 in range(rr + 1, min(rr + 4, c0[0])):
                    et = _plano(datos.get((r2, 33), ''))
                    vals = [datos.get((r2, c3), '') for c3 in range(cc, cc + 8)]
                    vals = [v for v in vals if v != '']
                    if et == 'TALLA':
                        tallas = vals
                    elif et == 'MEDIDA':
                        medidas = vals
                if tallas:
                    medidas_insumos.append({'titulo': t, 'tallas': tallas, 'medidas': medidas})
    ficha['medidas_insumos'] = medidas_insumos
    # --- confección
    t0 = _buscar(datos, 'TERMINACION Y EMPAQUE', col=2, desde=(c0[0] if c0 else 40), hasta=140)
    conf = []
    valores = {}
    if c0:
        fin = t0[0] if t0 else c0[0] + 30
        etiqueta = ''
        for rr in range(c0[0] + 2, fin):
            b, g, h = datos.get((rr, 2), ''), datos.get((rr, 7), ''), datos.get((rr, 8), '')
            if _plano(g).startswith('VALOR CONFECCION') or _plano(b).startswith('VALOR'):
                for c, t in _fila(datos, rr):
                    if _plano(t).startswith('VALOR'):
                        valores[_plano(t).lower()] = datos.get((rr + 1, c), '') or _derecha(datos, rr, c, c + 8)
                continue
            if b:
                etiqueta = b
            if g or h:
                conf.append({'etiqueta': b or ('' if etiqueta else ''), 'valor': g, 'extra': h})
    ficha['confeccion'] = conf
    ficha['valores_confeccion'] = valores
    # --- terminación y empaque
    ficha['terminacion'] = []
    ficha['empaque_insumos'] = []
    if t0:
        i1 = _buscar(datos, 'INSUMOS', col=2, desde=t0[0] + 1, hasta=t0[0] + 25, exacto=True)
        fin = i1[0] if i1 else t0[0] + 12
        for rr in range(t0[0] + 1, fin):
            t = datos.get((rr, 2), '')
            if t and not _plano(t).startswith('DESCRIPCION GENERAL'):
                ficha['terminacion'].append(t)
        if i1:
            ficha['empaque_insumos'] = _tabla(datos, i1[0] + 1, i1[0] + 14, ['NOMBRE', 'TIPO', 'COLOR', 'MEDIDA', 'CANT', 'PREVISUALIZACION', 'OBSERVACION'], 2, 40)
    return ficha


# ------------------------------------------------------------------ FIT REAL: las piezas de cada referencia tal como están dibujadas en su hoja
_XDR = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
_DML = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def _rels(z, ruta: str) -> dict:
    """{Id: (tipo, destino absoluto dentro del zip)} del archivo de relaciones de `ruta`."""
    import posixpath
    from xml.etree import ElementTree as ET
    carpeta, nombre = posixpath.split(ruta)
    try:
        raiz = ET.fromstring(z.read(f'{carpeta}/_rels/{nombre}.rels'))
    except KeyError:
        return {}
    salida = {}
    for r in raiz:
        destino = r.get('Target', '')
        destino = destino.lstrip('/') if destino.startswith('/') else posixpath.normpath(posixpath.join(carpeta, destino))
        salida[r.get('Id')] = (r.get('Type', '').rsplit('/', 1)[-1], destino)
    return salida


def _tema(z) -> list:
    """Colores del tema del libro en el orden que usa Excel (0 = claro 1, 1 = oscuro 1, 2 = claro 2, 3 = oscuro 2, 4… = énfasis)."""
    try:
        xml = z.read('xl/theme/theme1.xml').decode('utf-8', 'replace')
    except KeyError:
        return []
    orden = {}
    for nombre, cuerpo in re.findall(r'<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>(.*?)</a:\1>', xml, flags=re.S):
        m = re.search(r'(?:lastClr|val)="([0-9A-Fa-f]{6})"', cuerpo)
        orden[nombre] = m.group(1).upper() if m else '000000'
    return [orden.get(k, '000000') for k in ('lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink')]


def _color(c, tema: list) -> str:
    """Color de una celda (relleno o letra) como RRGGBB; '' si es automático o no se puede saber."""
    if c is None:
        return ''
    try:
        if c.type == 'rgb' and isinstance(c.rgb, str) and len(c.rgb) >= 6 and c.rgb != '00000000':
            return c.rgb[-6:].upper()
        if c.type == 'theme' and tema and 0 <= int(c.theme) < len(tema):
            r, g, b = (int(tema[int(c.theme)][i:i + 2], 16) for i in (0, 2, 4))
            t = float(c.tint or 0)
            mezcla = (lambda v: v + (255 - v) * t) if t > 0 else (lambda v: v * (1 + t))
            return '%02X%02X%02X' % tuple(max(0, min(255, round(mezcla(v)))) for v in (r, g, b))
    except (TypeError, ValueError):
        pass
    return ''


def _pics_de_grupo(grupo, gx: float, gy: float, gw: float, gh: float) -> list:
    """Imágenes dentro de un grupo de Excel con su caja en píxeles: [(pic, x, y, ancho, alto)]. El grupo ocupa (gx, gy, gw, gh) en la hoja y sus hijos
    vienen en las coordenadas internas del grupo (chOff/chExt); los grupos anidados se resuelven igual."""
    xf = grupo.find(f'{_XDR}grpSpPr/{_DML}xfrm')
    ch_off, ch_ext = (xf.find(_DML + 'chOff'), xf.find(_DML + 'chExt')) if xf is not None else (None, None)
    if ch_off is None or ch_ext is None or not int(ch_ext.get('cx') or 0) or not int(ch_ext.get('cy') or 0):
        return []
    ox, oy = int(ch_off.get('x') or 0), int(ch_off.get('y') or 0)
    sx, sy = gw / int(ch_ext.get('cx')), gh / int(ch_ext.get('cy'))
    salida = []
    for hijo in grupo:
        es_pic, es_grupo = hijo.tag == _XDR + 'pic', hijo.tag == _XDR + 'grpSp'
        if not (es_pic or es_grupo):
            continue
        hx = hijo.find(f'{_XDR}spPr/{_DML}xfrm') if es_pic else hijo.find(f'{_XDR}grpSpPr/{_DML}xfrm')
        off, ext = (hx.find(_DML + 'off'), hx.find(_DML + 'ext')) if hx is not None else (None, None)
        if off is None or ext is None:
            continue
        caja = (gx + (int(off.get('x') or 0) - ox) * sx, gy + (int(off.get('y') or 0) - oy) * sy, int(ext.get('cx') or 0) * sx, int(ext.get('cy') or 0) * sy)
        salida += [(hijo, *caja)] if es_pic else _pics_de_grupo(hijo, *caja)
    return salida


def _fit_real(z, ws, datos: dict, carpeta: Path, prefijo: str, tema: list) -> dict | None:
    """Reconstruye el recuadro «FIT DE PRENDA X PIEZAS» de la hoja: cada imagen de pieza en su sitio y con su tamaño, los rótulos de las celdas y los
    fondos de color (moldería femenina, niño…). Así la ficha muestra las piezas que de verdad lleva ESA referencia, no un dibujo genérico."""
    from xml.etree import ElementTree as ET
    from PIL import Image, ImageOps
    titulo = next(((r, c) for (r, c), t in sorted(datos.items()) if 8 <= r <= 14 and c < 32 and _plano(t).startswith('FIT')), None)
    fin = _buscar(datos, 'DESCRIPCION', col=2, desde=12, hasta=70, exacto=True)
    if not titulo:
        return None
    r0, r1, c0, c1 = titulo[0], (fin[0] if fin else titulo[0] + 22), 2, 32      # filas [r0, r1) y columnas B…AF (1-based)
    # medidas de columnas y filas en píxeles
    anchos = {}
    for cd in ws.column_dimensions.values():
        for i in range(cd.min or 0, (cd.max or 0) + 1):
            anchos[i] = 0 if cd.hidden else cd.width
    ancho_def = ws.sheet_format.defaultColWidth or 8.43
    xs = [0.0]
    for i in range(1, 60):
        w = anchos.get(i)
        xs.append(xs[-1] + (0 if w == 0 else int((w or ancho_def) * 7 + 5)))
    alto_def = ws.sheet_format.defaultRowHeight or 15
    ys = [0.0]
    for i in range(1, r1 + 3):
        rd = ws.row_dimensions[i] if i in ws.row_dimensions else None
        ys.append(ys[-1] + (0 if (rd is not None and rd.hidden) else ((rd.height if rd is not None and rd.height else alto_def) * 96 / 72)))
    x0, y0, x1, y1 = xs[c0 - 1], ys[r0 - 1], xs[c1], ys[r1 - 1]
    # hoja -> dibujo -> imágenes
    libro = ET.fromstring(z.read('xl/workbook.xml'))
    rid = next((h.get(_REL + 'id') for h in libro.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet') if h.get('name') == ws.title), None)
    hoja = _rels(z, 'xl/workbook.xml').get(rid, ('', ''))[1]
    dibujo = next((d for t, d in _rels(z, hoja).values() if t == 'drawing'), '') if hoja else ''
    if not dibujo:
        return None
    medios = _rels(z, dibujo)
    imagenes = []
    carpeta.mkdir(parents=True, exist_ok=True)
    formas = []   # rectángulos de color dibujados como formas (los recuadros rosados/azules de la moldería femenina y de niño)
    for ancla in ET.fromstring(z.read(dibujo)):
        pic, forma, grupo = ancla.find(_XDR + 'pic'), ancla.find(_XDR + 'sp'), ancla.find(_XDR + 'grpSp')
        desde = ancla.find(_XDR + 'from')
        if (pic is None and forma is None and grupo is None) or desde is None:
            continue
        col, fila = int(desde.findtext(_XDR + 'col')), int(desde.findtext(_XDR + 'row'))
        if not (c0 - 1 <= col < c1 and r0 - 1 <= fila < r1 - 1):
            continue
        px = xs[col] + int(desde.findtext(_XDR + 'colOff') or 0) / 9525
        py = ys[fila] + int(desde.findtext(_XDR + 'rowOff') or 0) / 9525
        hasta, ext = ancla.find(_XDR + 'to'), ancla.find(_XDR + 'ext')
        if hasta is not None:
            w = xs[int(hasta.findtext(_XDR + 'col'))] + int(hasta.findtext(_XDR + 'colOff') or 0) / 9525 - px
            h = ys[min(int(hasta.findtext(_XDR + 'row')), len(ys) - 1)] + int(hasta.findtext(_XDR + 'rowOff') or 0) / 9525 - py
        elif ext is not None:
            w, h = int(ext.get('cx')) / 9525, int(ext.get('cy')) / 9525
        else:
            continue
        if pic is None and grupo is None:
            relleno = forma.find(f'{_XDR}spPr/{_DML}solidFill/{_DML}srgbClr')
            if relleno is not None and relleno.get('val') and w > 8 and h > 8:
                formas.append({'x': round(px - x0, 1), 'y': round(py - y0, 1), 'w': round(w, 1), 'h': round(h, 1), 'c': relleno.get('val').upper()})
            continue
        # una imagen suelta, o todas las imágenes de un grupo (piezas agrupadas en el Excel), cada una en su sitio
        for pic, px, py, w, h in ([(pic, px, py, w, h)] if pic is not None else _pics_de_grupo(grupo, px, py, w, h)):
            blip = pic.find(f'{_XDR}blipFill/{_DML}blip')
            destino = medios.get(blip.get(_REL + 'embed') if blip is not None else '', ('', ''))[1]
            if not destino or w < 4 or h < 4:
                continue
            try:
                img = Image.open(io.BytesIO(z.read(destino)))
                img.load()
                rec = pic.find(f'{_XDR}blipFill/{_DML}srcRect')
                if rec is not None:
                    l, t, r, b = (int(rec.get(k) or 0) / 100000 for k in 'ltrb')
                    img = img.crop((round(img.width * l), round(img.height * t), round(img.width * (1 - r)), round(img.height * (1 - b))))
                xf = pic.find(f'{_XDR}spPr/{_DML}xfrm')
                img = img.convert('RGBA')
                if xf is not None:
                    if xf.get('flipH') == '1':
                        img = ImageOps.mirror(img)
                    if xf.get('flipV') == '1':
                        img = ImageOps.flip(img)
                    if int(xf.get('rot') or 0):
                        img = img.rotate(-int(xf.get('rot')) / 60000, expand=True)
                if max(img.size) > 900:
                    img.thumbnail((900, 900))
                nombre = f'{prefijo}_fit{len(imagenes)}.png'
                img.save(carpeta / nombre, 'PNG', optimize=True)
            except Exception:  # noqa: BLE001  una imagen que no se puede leer no frena la ficha
                continue
            imagenes.append({'a': nombre, 'x': round(px - x0, 1), 'y': round(py - y0, 1), 'w': round(w, 1), 'h': round(h, 1)})
    if not imagenes:
        return None
    combinadas = {(m.min_row, m.min_col): m for m in ws.merged_cells.ranges}
    rotulos, fondos = [], []
    for r in range(r0, r1):
        tramo = None
        for c in range(c0, c1 + 1):
            celda = ws.cell(row=r, column=c)
            relleno = _color(celda.fill.fgColor, tema) if celda.fill is not None and celda.fill.fill_type == 'solid' else ''
            if relleno in ('FFFFFF', ''):
                relleno = ''
            comb = combinadas.get((r, c))
            if relleno and comb is not None:   # celda combinada: el color cubre toda la combinación, no solo su primera celda
                fondos.append({'x': round(xs[c - 1] - x0, 1), 'y': round(ys[r - 1] - y0, 1), 'w': round(xs[min(comb.max_col, c1)] - xs[c - 1], 1),
                               'h': round(ys[min(comb.max_row, r1 - 1)] - ys[r - 1], 1), 'c': relleno})
                tramo = None
            elif tramo and tramo['c'] == relleno:
                tramo['w'] = round(xs[c] - x0 - tramo['x'], 1)
            else:
                tramo = {'x': round(xs[c - 1] - x0, 1), 'y': round(ys[r - 1] - y0, 1), 'w': round(xs[c] - xs[c - 1], 1), 'h': round(ys[r] - ys[r - 1], 1), 'c': relleno}
                if relleno:
                    fondos.append(tramo)
            texto = datos.get((r, c), '')
            if texto:
                m = combinadas.get((r, c))
                cf, ff = (min(m.max_col, c1), min(m.max_row, r1 - 1)) if m else (c, r)
                rotulos.append({'t': texto[:80], 'x': round(xs[c - 1] - x0, 1), 'y': round(ys[r - 1] - y0, 1), 'w': round(xs[cf] - xs[c - 1], 1), 'h': round(ys[ff] - ys[r - 1], 1),
                                'al': 'c' if (celda.alignment is not None and celda.alignment.horizontal in ('center', 'centerContinuous')) else 'i',
                                'n': bool(celda.font is not None and celda.font.bold), 'p': round(float(celda.font.sz or 11) * 96 / 72, 1) if celda.font is not None else 14.7,
                                'c': _color(celda.font.color, tema) if celda.font is not None else ''})
    return {'w': round(x1 - x0, 1), 'h': round(y1 - y0, 1), 'imagenes': imagenes, 'rotulos': rotulos, 'fondos': fondos + formas}


def _zona(col0: int, fila0: int) -> str:
    """Dónde cae una imagen en la plantilla (0-based)."""
    if col0 >= 32:
        if fila0 < 19:
            return 'mockup'
        if fila0 < 30:
            return 'fisica'
        if fila0 < 52:
            return 'insumos'
        return 'lupa'
    if col0 >= 26 and 36 <= fila0 <= 60:
        return 'insumos'
    if fila0 <= 34:
        return 'piezas'
    return 'otras'


def _guardar_imagenes(ws, carpeta: Path, prefijo: str) -> list:
    from PIL import Image
    salida = []
    carpeta.mkdir(parents=True, exist_ok=True)
    for i, im in enumerate(getattr(ws, '_images', []) or []):
        try:
            a = im.anchor
            col0, fila0 = a._from.col, a._from.row
            datos = im._data()
            img = Image.open(io.BytesIO(datos))
            ancho, alto = img.size
            if max(ancho, alto) > MAX_PX:
                img.thumbnail((MAX_PX, MAX_PX))
            if img.mode not in ('RGB', 'L'):
                fondo = Image.new('RGB', img.size, (255, 255, 255))
                fondo.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[-1])
                img = fondo
            nombre = f'{prefijo}_{i}.jpg'
            img.convert('RGB').save(carpeta / nombre, 'JPEG', quality=82)
            salida.append({'n': i, 'archivo': nombre, 'zona': _zona(col0, fila0), 'col': col0, 'fila': fila0, 'ancho': img.size[0], 'alto': img.size[1]})
        except Exception:  # noqa: BLE001  una imagen que no se puede leer no frena la ficha
            continue
    salida.sort(key=lambda x: (x['fila'], x['col']))
    return salida


def _ref_de(hoja: str, referencia: str) -> str:
    for t in (hoja, referencia):
        m = re.search(r'[A-Za-z]{1,5}\d{2,3}', str(t or ''))
        if m:
            return m.group(0).upper()
    return _plano(hoja)


def importar(carpeta_excel: Path) -> dict:
    """Lee todos los libros de la carpeta y guarda las fichas ya procesadas. Se ejecuta en un hilo (puede tardar varios minutos)."""
    import openpyxl
    t0 = time.time()
    indice, libros = [], 0
    DATOS.mkdir(parents=True, exist_ok=True)
    archivos = sorted(p for p in carpeta_excel.glob('*.xlsx') if not p.name.startswith(('~$', 'Copia de')))
    for k, libro in enumerate(archivos, 1):
        estado['progreso'] = f'{k}/{len(archivos)} · {libro.stem}'
        try:
            wb = openpyxl.load_workbook(libro, data_only=True)
        except Exception as e:  # noqa: BLE001
            estado['error'] = f'{libro.name}: {e}'
            continue
        libros += 1
        familia = re.sub(r'\s*\([A-Z]{1,5}\)\s*$', '', libro.stem.replace('_', ' ')).strip()
        try:
            import zipfile
            zlibro = zipfile.ZipFile(libro)
            tema = _tema(zlibro)
        except Exception:  # noqa: BLE001
            zlibro, tema = None, []
        for ws in wb.worksheets[1:]:
            try:
                ficha = _hoja_a_ficha(ws)
                if not ficha:
                    continue
                ident = f'{_slug(libro.stem)}__{_slug(ws.title)}'
                imagenes = _guardar_imagenes(ws, DATOS / 'img' / _slug(libro.stem), _slug(ws.title))
                try:   # el fit real de la referencia (si algo falla, la ficha queda con el dibujo genérico)
                    ficha['fit'] = _fit_real(zlibro, ws, _celdas(ws), DATOS / 'img' / _slug(libro.stem), _slug(ws.title), tema) if zlibro else None
                except Exception as e:  # noqa: BLE001
                    ficha['fit'] = None
                    estado['error'] = f'{libro.name} / {ws.title} (fit): {e}'
                ficha.update(id=ident, archivo=libro.name, familia=familia, ref=_ref_de(ws.title, ficha.get('referencia', '')), imagenes=imagenes)
                (DATOS / f'{ident}.json').write_text(json.dumps(ficha, ensure_ascii=False), encoding='utf-8')
                grandes = sorted(imagenes, key=lambda i: i['ancho'] * i['alto'], reverse=True)
                portada = next((i for i in grandes if i['zona'] in ('mockup', 'fisica')), None) or next(iter(grandes), None)   # la imagen digital si hay; si no, la más grande
                indice.append({'id': ident, 'ref': ficha['ref'], 'hoja': ws.title, 'familia': familia, 'archivo': libro.name, 'prenda': ficha.get('prenda', ''),
                               'referencia': ficha.get('referencia', ''), 'portada': portada['archivo'] if portada else '', 'imagenes': len(imagenes),
                               'promedio': (ficha['promedios'][0]['valores'] if ficha.get('promedios') else {})})
            except Exception as e:  # noqa: BLE001
                estado['error'] = f'{libro.name} / {ws.title}: {e}'
        try:
            wb.close()
        except Exception:  # noqa: BLE001
            pass
        estado['fichas'] = len(indice)
    indice.sort(key=lambda x: (x['familia'], x['ref'], x['hoja']))
    ahora = datetime.now(timezone.utc).isoformat()
    (DATOS / 'indice.json').write_text(json.dumps({'actualizado': ahora, 'segundos': round(time.time() - t0), 'fichas': indice}, ensure_ascii=False), encoding='utf-8')
    return {'actualizado': ahora, 'libros': libros, 'fichas': len(indice)}


def correr_importacion(carpeta_excel: Path) -> bool:
    """Arranca la importación en segundo plano; False si ya hay una en curso."""
    with _lock:
        if estado['importando']:
            return False
        estado.update(importando=True, progreso='iniciando', error='', fichas=0)

    def trabajo():
        try:
            r = importar(carpeta_excel)
            estado.update(actualizado=r['actualizado'], libros=r['libros'], fichas=r['fichas'], progreso='terminado')
        except Exception as e:  # noqa: BLE001
            estado['error'] = str(e)
            estado['progreso'] = 'falló'
        finally:
            estado['importando'] = False

    threading.Thread(target=trabajo, daemon=True).start()
    return True


def indice() -> dict:
    try:
        return json.loads((DATOS / 'indice.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'actualizado': '', 'fichas': []}


def ficha(ident: str) -> dict | None:
    if not re.fullmatch(r'[a-z0-9-]+__[a-z0-9-]+', ident or ''):
        return None
    try:
        return json.loads((DATOS / f'{ident}.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def ruta_imagen(ident: str, archivo: str) -> Path | None:
    if not re.fullmatch(r'[a-z0-9-]+__[a-z0-9-]+', ident or '') or not re.fullmatch(r'[a-z0-9-]+_(?:\d+\.jpg|fit\d+\.png)', archivo or ''):
        return None
    libro = ident.split('__')[0]
    p = DATOS / 'img' / libro / archivo
    return p if p.is_file() else None


# ------------------------------------------------------------------ mockup de referencia de cada REF (imagen que sube una persona)
def _ref_valida(ref: str) -> str:
    ref = re.sub(r'[^A-Za-z0-9]', '', str(ref or '')).upper()
    if not re.fullmatch(r'[A-Z]{1,5}\d{2,3}', ref):
        raise ValueError('La referencia debe verse así: FUT02, CA01, CH01…')
    return ref


def guardar_mockup(ref: str, datos: bytes) -> dict:
    """Guarda la imagen de referencia (mockup) de una REF. Acepta JPG, PNG o WEBP; la achica a 1800 px de alto y la deja como JPG."""
    from PIL import Image
    ref = _ref_valida(ref)
    if len(datos) > 25 * 1024 * 1024:
        raise ValueError('La imagen pesa más de 25 MB')
    try:
        img = Image.open(io.BytesIO(datos))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError('El archivo no es una imagen válida (usa JPG, PNG o WEBP)') from e
    if img.mode in ('RGBA', 'LA', 'P'):
        base = Image.new('RGB', img.size, (255, 255, 255))
        rgba = img.convert('RGBA')
        base.paste(rgba, mask=rgba.split()[-1])
        img = base
    img = img.convert('RGB')
    if max(img.size) > 1800:
        img.thumbnail((1800, 1800))
    carpeta = DATOS / 'mockups'
    carpeta.mkdir(parents=True, exist_ok=True)
    img.save(carpeta / f'{ref}.jpg', 'JPEG', quality=88)
    return {'ref': ref, 'ancho': img.size[0], 'alto': img.size[1]}


def ruta_mockup(ref: str):
    try:
        p = DATOS / 'mockups' / f'{_ref_valida(ref)}.jpg'
    except ValueError:
        return None
    return p if p.is_file() else None


def borrar_mockup(ref: str) -> bool:
    p = ruta_mockup(ref)
    if p:
        p.unlink()
        return True
    return False


def con_mockup() -> dict:
    """{REF: versión} de las REF que ya tienen mockup (la versión cambia cuando se sube otra imagen, para que el navegador no use la vieja)."""
    carpeta = DATOS / 'mockups'
    if not carpeta.is_dir():
        return {}
    return {p.stem: int(p.stat().st_mtime) for p in carpeta.glob('*.jpg')}
