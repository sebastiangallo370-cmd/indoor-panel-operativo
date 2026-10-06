"""Lectura de notas de entrega (PDF o imagen) para proponer ingresos de tela.

El OCR se usa solo para proponer datos: el usuario revisa y confirma antes de registrar nada.
"""
from __future__ import annotations

import io
import math
import os
import re
import subprocess
import tempfile
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher

import pdfplumber
from PIL import Image, ImageOps

MAX_PAGES = 5
NUMBER = re.compile(r'\d+(?:\.\d+)?')


def norm(value) -> str:
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(char for char in text if unicodedata.category(char) != 'Mn')
    return re.sub(r'\s+', ' ', text.upper()).strip()


# El servidor tiene un solo procesador: con varios hilos tesseract compite consigo mismo y tarda ~4 veces más.
_TESSERACT_ENV = {**os.environ, 'OMP_THREAD_LIMIT': '1'}


def _tesseract(path: str, *args: str, timeout: int = 180) -> str:
    result = subprocess.run(['tesseract', path, 'stdout', *args], capture_output=True, text=True, timeout=timeout, env=_TESSERACT_ENV)
    return result.stdout


def _save_temp(image: Image.Image) -> str:
    handle = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    handle.close()
    image.save(handle.name, 'PNG')
    return handle.name


def load_images(data: bytes, filename: str) -> list[Image.Image]:
    if data[:4] == b'%PDF' or filename.lower().endswith('.pdf'):
        images = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:MAX_PAGES]:
                images.append(page.to_image(resolution=250).original.convert('RGB'))
        return images
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB')
    if image.width < 1800:
        factor = 1800 / image.width
        image = image.resize((int(image.width * factor), int(image.height * factor)), Image.LANCZOS)
    return [image]


def _words(image: Image.Image) -> list[dict]:
    path = _save_temp(image)
    try:
        tsv = _tesseract(path, '-l', 'spa', '--psm', '6', 'tsv')
    finally:
        os.unlink(path)
    words = []
    for row in tsv.splitlines()[1:]:
        parts = row.split('\t')
        if len(parts) < 12 or not parts[11].strip():
            continue
        try:
            left, top, width, height = (int(parts[i]) for i in (6, 7, 8, 9))
        except ValueError:
            continue
        words.append({'line': (int(parts[2]), int(parts[3]), int(parts[4])), 'left': left, 'top': top,
                      'right': left + width, 'bottom': top + height, 'text': parts[11].strip()})
    return words


def _remove_rules(binary: Image.Image) -> Image.Image:
    """Borra las líneas del borde de la celda (también las inclinadas) sin tocar los dígitos centrales."""
    width, height = binary.size
    pixels = binary.load()
    rows = binary.resize((1, height), Image.BOX)
    cols = binary.resize((width, 1), Image.BOX)
    edge_x, edge_y = int(width * 0.2), int(height * 0.25)
    for y in range(height):
        limit = 190 if (y < edge_y or y > height - edge_y) else 110
        if rows.getpixel((0, y)) < limit:
            for x in range(width):
                pixels[x, y] = 255
    for x in range(width):
        limit = 200 if (x < edge_x or x > width - edge_x) else 110
        if cols.getpixel((x, 0)) < limit:
            for y in range(height):
                pixels[x, y] = 255
    return binary


def _read_number(image: Image.Image, box: tuple[int, int, int, int]) -> float | None:
    x0, y0, x1, y1 = box
    crop = image.crop((max(0, x0), max(0, y0), min(image.width, x1), min(image.height, y1))).convert('L')
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
    crop = ImageOps.autocontrast(crop).point(lambda value: 255 if value > 150 else 0)
    crop = _remove_rules(crop)
    box = ImageOps.invert(crop).getbbox()
    if not box:
        return None
    crop = ImageOps.expand(crop.crop(box), border=25, fill=255)
    path = _save_temp(crop)
    try:
        text = _tesseract(path, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789.,', timeout=60)
    finally:
        os.unlink(path)
    text = text.strip().replace(',', '.').replace(' ', '')
    found = NUMBER.search(text)
    if not found:
        return None
    raw = found.group(0)
    if re.fullmatch(r'\d+\.\d{3,}', raw):
        raw = raw[:raw.index('.') + 3]
    if '.' not in raw and len(raw) >= 4 and raw.endswith('00'):
        return float(raw) / 100
    return float(raw)


def _cell_candidates(image: Image.Image, box: tuple[int, int, int, int]) -> list[float]:
    """Varias lecturas de una celda (con distintos contrastes); devuelve los valores "00.00" del más al menos repetido."""
    gray = image.crop(box).convert('L')
    gray = ImageOps.autocontrast(gray.resize((gray.width * 3, gray.height * 3), Image.LANCZOS), cutoff=2)
    found: list[float] = []
    for threshold in (None, 110, 140, 170):
        variant = gray if threshold is None else gray.point(lambda value, t=threshold: 255 if value > t else 0)
        path = _save_temp(ImageOps.expand(variant, border=30, fill=255))
        try:
            text = _tesseract(path, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789.,', timeout=30)
        finally:
            os.unlink(path)
        text = text.strip().replace(',', '.').replace(' ', '')
        if re.fullmatch(r'\d{1,5}\.\d{2}', text):
            found.append(float(text))
    return [value for value, _ in Counter(found).most_common()]


def _read_column(image: Image.Image, box: tuple[int, int, int, int]) -> list[list[float]]:
    """Respaldo para fotos: corta la columna CANTIDAD por las rayas de la tabla y lee celda por celda."""
    x0, y0, x1, y1 = (max(0, box[0]), max(0, box[1]), min(image.width, box[2]), min(image.height, box[3]))
    if x1 - x0 < 20 or y1 - y0 < 20:
        return []
    gray = ImageOps.autocontrast(image.crop((x0, y0, x1, y1)).convert('L'), cutoff=2)
    width, height = gray.size
    pixels = gray.load()
    inner = range(int(width * 0.1), int(width * 0.9))
    rules = [y for y in range(height) if sum(1 for x in inner if pixels[x, y] < 120) > 0.45 * len(inner)]
    bands, start = [], 0
    for y in rules + [height]:
        if y - start > 12:
            bands.append((start, y))
        start = y + 1
    margin = int(width * 0.08)
    cells = [_cell_candidates(image, (x0 + margin, y0 + top + 2, x1 - margin, y0 + bottom - 2)) for top, bottom in bands]
    return [options for options in cells if options]


def _match_total(cells: list[list[float]], total: float) -> list[float] | None:
    """Elige una lectura por celda de modo que la suma dé el total del documento (prefiere las más repetidas)."""
    options = [cell[:3] for cell in cells]
    combos = 1
    for cell in options:
        combos *= len(cell)
    if not options or combos > 200000:
        return None
    best: tuple[int, list[float]] | None = None

    def search(index: int, chosen: list[float], cost: int, partial: float) -> None:
        nonlocal best
        if best is not None and cost >= best[0]:
            return
        if index == len(options):
            if abs(partial - total) <= 0.01:
                best = (cost, list(chosen))
            return
        for rank, value in enumerate(options[index]):
            chosen.append(value)
            search(index + 1, chosen, cost + rank, partial + value)
            chosen.pop()

    search(0, [], 0, 0.0)
    return best[1] if best else None


def _first(words: list[dict], *names: str) -> dict | None:
    wanted = {norm(n) for n in names}
    return next((w for w in words if norm(w['text']).strip('.:') in wanted), None)


def _skew_degrees(words: list[dict]) -> float:
    """Inclinación del texto (grados). Positivo = las líneas bajan hacia la derecha (foto torcida)."""
    lines: dict[tuple, list[dict]] = defaultdict(list)
    for word in words:
        lines[word['line']].append(word)
    slopes = []
    for ws in lines.values():
        points = [((w['left'] + w['right']) / 2, (w['top'] + w['bottom']) / 2) for w in ws if len(w['text']) >= 2]
        if len(points) < 3 or max(x for x, _ in points) - min(x for x, _ in points) < 250:
            continue
        mean_x = sum(x for x, _ in points) / len(points)
        mean_y = sum(y for _, y in points) / len(points)
        spread = sum((x - mean_x) ** 2 for x, _ in points)
        if spread:
            slopes.append(sum((x - mean_x) * (y - mean_y) for x, y in points) / spread)
    if len(slopes) < 3:
        return 0.0
    slopes.sort()
    return math.degrees(math.atan(slopes[len(slopes) // 2]))


def parse_page(image: Image.Image) -> dict:
    words = _words(image)
    # Fotos tomadas con el celular: si la hoja está torcida, se endereza y se vuelve a leer,
    # para que cada cantidad quede a la misma altura que su fila.
    angle = _skew_degrees(words)
    if 0.4 <= abs(angle) <= 15:
        image = image.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor='white')
        words = _words(image)
    lines: dict[tuple, list[dict]] = defaultdict(list)
    for word in words:
        lines[word['line']].append(word)
    ordered = sorted(lines.values(), key=lambda ws: min(w['top'] for w in ws))
    text_lines = [' '.join(w['text'] for w in sorted(ws, key=lambda w: w['left'])) for ws in ordered]

    header = next((ws for ws in ordered if _first(ws, 'CANTIDAD') and (_first(ws, 'DESCRIPCION') or _first(ws, 'REFERENCIA'))), None)
    result = {'proveedor': '', 'fecha': '', 'total_documento': None, 'filas': [], 'texto': '\n'.join(text_lines)}
    for line in text_lines[:8]:
        if re.search(r'S\.?A\.?S|LTDA|S\.A\.', line, re.I):
            result['proveedor'] = re.sub(r'^\W*\w{1,3}\s+(?=[A-ZÁÉÍÓÚ]{4})', '', line).strip()
            break
    date = re.search(r'(\d{2}[./-]\d{2}[./-]\d{4})', result['texto'])
    result['fecha'] = date.group(1) if date else ''
    if not header:
        return result

    qty_head = _first(header, 'CANTIDAD')
    um_head = _first(header, 'U.M', 'U.M.', 'UM')
    desc_head = _first(header, 'DESCRIPCION')
    ref_head = _first(header, 'REFERENCIA')
    roll_head = next((w for w in header if norm(w['text']) == 'NO' and desc_head and w['left'] > desc_head['left']), None)
    qty_box = (qty_head['left'] - 25, (um_head['left'] - 10) if um_head else qty_head['right'] + 40)
    desc_box = (desc_head['left'] - 10 if desc_head else 0, (roll_head['left'] - 5) if roll_head else (desc_head['right'] + 260 if desc_head else 0))
    ref_box = (ref_head['left'] - 10, desc_head['left'] - 5) if ref_head and desc_head else None
    header_bottom = max(w['bottom'] for w in header)

    finished = False
    total_top = None
    for ws in ordered:
        top, bottom = min(w['top'] for w in ws), max(w['bottom'] for w in ws)
        if top <= header_bottom:
            continue
        joined = norm(' '.join(w['text'] for w in ws))
        in_desc = ' '.join(w['text'] for w in sorted(ws, key=lambda w: w['left']) if desc_box[0] <= (w['left'] + w['right']) / 2 <= desc_box[1])
        is_total = any(key in joined for key in ('TOTAL', 'BULTO', 'ROLLOS'))
        if is_total:
            finished = True
            total_top = top if total_top is None else total_top
            if 'TOTAL GENERAL' in joined:
                result['total_documento'] = _read_number(image, (qty_box[0], top - 6, qty_box[1], bottom + 6))
            continue
        if finished:
            continue
        if len(re.findall(r'[A-Za-zÁÉÍÓÚáéíóú]', in_desc)) < 4:
            continue
        qty = _read_number(image, (qty_box[0], top - 6, qty_box[1], bottom + 6))
        reference = ''
        if ref_box:
            reference = ' '.join(w['text'] for w in sorted(ws, key=lambda w: w['left']) if ref_box[0] <= (w['left'] + w['right']) / 2 <= ref_box[1])
        roll_no = ''
        if roll_head:
            digits = ''.join(re.findall(r'\d+', ' '.join(w['text'] for w in ws if roll_head['left'] - 15 <= w['left'] <= roll_head['left'] + 260)))
            roll_no = digits if len(digits) >= 8 else ''
        result['filas'].append({'descripcion': in_desc.strip(), 'referencia': reference.strip(), 'rollo_no': roll_no, 'mts': qty})

    # Validación contra el TOTAL GENERAL del documento. Si la lectura fila por fila no cuadra (típico en fotos),
    # se lee la columna CANTIDAD completa y se usa si su suma sí coincide con el total.
    total = result['total_documento']
    rows = result['filas']
    row_sum = sum(row['mts'] or 0 for row in rows)
    if total and rows and (any(row['mts'] is None for row in rows) or abs(row_sum - total) > 0.01):
        column = _match_total(_read_column(image, (qty_box[0], header_bottom + 4, qty_box[1], (total_top or image.height) - 4)), total)
        if column:
            if len(column) == len(rows):
                for row, value in zip(rows, column):
                    row['mts'] = value
            else:
                main_desc = Counter(norm(row['descripcion']) for row in rows).most_common(1)[0][0]
                base = next(row for row in rows if norm(row['descripcion']) == main_desc)
                result['filas'] = [{'descripcion': base['descripcion'], 'referencia': base['referencia'], 'rollo_no': '', 'mts': value}
                                   for value in column]
    return result


_INVOICE_LINE = re.compile(r'^\s*\d+\s+(\d{3,})\s+(.+?)\s+(MTS?|M)\s+([\d.,]+)\s+\$', re.I | re.M)


def parse_invoice_text(data: bytes) -> dict | None:
    """Factura electrónica en PDF (con texto, no escaneada): una línea por tela con su cantidad en metros.
    La factura no trae el detalle de rollos: cada tela entra como un solo rollo con el total y se puede repartir en la pantalla."""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            text = '\n'.join((page.extract_text() or '') for page in pdf.pages)
    except Exception:
        return None
    if 'FACTURA' not in text.upper():
        return None
    lines = []
    for code, description, _unit, quantity in _INVOICE_LINE.findall(text):
        try:
            meters = float(quantity.replace(',', ''))
        except ValueError:
            continue
        if meters > 0:
            lines.append({'descripcion': description.strip(), 'referencia': code, 'rollos': [{'mts': meters, 'rollo_no': ''}]})
    if not lines:
        return None
    supplier = re.search(r'^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .&]+?(?:S\.?A\.?S\.?|LTDA\.?|S\.?A\.?))\s*(?:No\.|$)', text, re.M)
    date = re.search(r'Fecha facturaci[^:]*:\s*(\d{4}/\d{2}/\d{2})', text)
    return {'proveedor': (supplier.group(1).strip() if supplier else ''), 'fecha': date.group(1) if date else '',
            'total_documento': round(sum(r['mts'] for line in lines for r in line['rollos']), 2), 'lineas': lines, 'tipo': 'factura'}


_EMPAQUE_ARTICULO = re.compile(r'^\s*(\d{5,7})\s*-\s*(.+)$')
_EMPAQUE_DECIMALES = re.compile(r'\d+\.\d{2}(?!\d)')
_EMPAQUE_ID = re.compile(r'\d{7,}')


def _limpiar_articulo(texto: str) -> str:
    """El OCR deja basura al final del nombre («SUPER ZENTRA PLUS DB E A»): se quitan las palabras sueltas o en minúscula del final."""
    palabras = texto.split()
    while palabras and (len(palabras[-1]) == 1 or palabras[-1].islower()):
        palabras.pop()
    return ' '.join(palabras)


def parse_packing_list_text(texto: str) -> dict | None:
    """Texto OCR de una «LISTA DE EMPAQUE» de Lindatextil: por artículo, un rollo por fila (ID, Cant. en metros, Cant.adic en kg)."""
    if 'LISTA DE EMPAQUE' not in texto.upper() or 'LINDATEXTIL' not in texto.upper():
        return None
    articulos: list[dict] = []
    actual = None
    for linea in texto.splitlines():
        limpia = re.sub(r'(?<=\d),(?=\d{3}\b)', '', linea.strip())   # 3,046.86 -> 3046.86
        if not limpia:
            continue
        match = _EMPAQUE_ARTICULO.match(limpia)
        if match and not limpia.upper().startswith('TOTAL'):
            actual = {'referencia': match.group(1), 'descripcion': _limpiar_articulo(match.group(2)), 'color': '', 'rollos': []}
            articulos.append(actual)
            continue
        if re.match(r'^(subt|total|resumen)', limpia, re.I):
            if actual is not None and not actual['color']:
                sub = re.match(r'^subt\w*\s*\(([^)]+)\)\s*(\w+)?', limpia, re.I)
                if sub:
                    actual['color'] = f"({sub.group(1).strip()})" + (f" {sub.group(2)}" if sub.group(2) else '')
            continue
        if actual is None:
            # página de continuación («Pag. 2 de 2»): las filas llegan sin el encabezado del artículo; se toma el nombre del Subtotal
            if len(_EMPAQUE_DECIMALES.findall(limpia)) >= 2 and re.search(r'PEN-|\d{6,}', limpia):
                actual = {'referencia': '', 'descripcion': 'Tela de la lista de empaque', 'color': '', 'rollos': []}
                articulos.append(actual)
            else:
                continue
        if not actual['color']:
            color = re.match(r'^\(([^)]+)\)\s*(\w+)?', limpia)
            if color:
                actual['color'] = f"({color.group(1).strip()})" + (f" {color.group(2)}" if color.group(2) else '')
        decimales = _EMPAQUE_DECIMALES.findall(limpia)
        identificador = _EMPAQUE_ID.search(limpia)
        if len(decimales) >= 2 and (identificador or re.search(r'PEN-', limpia)):   # el ID puede salir ilegible del OCR: el rollo igual cuenta
            actual['rollos'].append({'mts': float(decimales[-2]), 'rollo_no': identificador.group(0)[:7] if identificador else ''})
    lineas = []
    for a in articulos:
        if not a['rollos']:
            continue
        nombre = (a['descripcion'] + (' ' + a['color'] if a['color'] else '')).strip()
        lineas.append({'descripcion': nombre, 'referencia': a['referencia'], 'rollos': a['rollos']})
    if not lineas:
        return None
    fecha = re.search(r'Fecha:?\s*(\d{4}/\d{2}/\d{2})', texto)
    normal = re.sub(r'(?<=\d),(?=\d{3}\b)', '', texto)
    total = re.findall(r'^\s*Total\s+\d{5,7}\s*-.*?(\d+\.\d{2})\s+\d+\.\d{2}\s*$', normal, re.M | re.I)
    suma = round(sum(r['mts'] for l in lineas for r in l['rollos']), 2)
    if not total:   # sin línea «Total»: el subtotal solo sirve de control si cuadra con esta página (en «Pag. 2 de 2» es acumulado)
        sub = re.findall(r'^\s*Subt\w*.*?(\d+\.\d{2})\s+\d+\.\d{2}\s*$', normal, re.M | re.I)
        total = [sub[0]] if sub and abs(float(sub[0]) - suma) < 0.5 else []
    return {'proveedor': 'TEJIDOS DE PUNTO LINDATEXTIL S.A.S.', 'fecha': fecha.group(1) if fecha else '',
            'total_documento': round(sum(float(t) for t in total), 2) if total else None, 'lineas': lineas, 'tipo': 'lista_empaque'}


def parse_packing_list(data: bytes, filename: str) -> dict | None:
    imagenes = load_images(data, filename)
    textos = []
    for imagen in imagenes:
        ruta = _save_temp(imagen)
        try:
            textos.append(_tesseract(ruta, '-l', 'spa', '--psm', '6'))
        finally:
            try:
                os.unlink(ruta)
            except OSError:
                pass
    paginas = [r for r in (parse_packing_list_text(t) for t in textos) if r]
    if not paginas:
        return None
    unido = paginas[0]
    for extra in paginas[1:]:
        unido['lineas'].extend(extra['lineas'])
        unido['total_documento'] = (unido['total_documento'] or 0) + (extra['total_documento'] or 0)
    return unido


# Formatos de documento por proveedor. Cada proveedor entrega el PDF distinto: se elige el formato al subirlo y todos terminan en el mismo resultado
# estándar {proveedor, fecha, total_documento, lineas:[{descripcion, referencia, rollos:[{mts, rollo_no}]}]}. Para sumar un proveedor nuevo se agrega
# un lector (función) y una fila aquí; la pantalla toma la lista de /api/inventarios/documento/formatos.
FORMATOS = [
    {'id': 'auto', 'nombre': 'Detectar automáticamente', 'ayuda': 'Prueba los formatos conocidos y usa el que coincida.'},
    {'id': 'lindatextil', 'nombre': 'Lindatextil', 'ayuda': 'Lista de empaque (escaneo o foto, un rollo por fila con su total) o factura electrónica en PDF (entra 1 rollo con el total y lo repartes).'},
    {'id': 'eliot', 'nombre': 'Manufacturas Eliot', 'ayuda': 'Nota de entrega (escaneo, foto o PDF): lee la columna CANTIDAD, un rollo por fila, y la contrasta con el total.'},
    {'id': 'lafayette', 'nombre': 'Lafayette · formato por configurar', 'pendiente': True, 'ayuda': 'Todavía no tengo el formato de este proveedor. Si el PDF trae texto intento leerlo; si no, usa «registrar a mano» y envíame un PDF de ejemplo para configurarlo.'},
    {'id': 'saraxy', 'nombre': 'Saraxy · formato por configurar', 'pendiente': True, 'ayuda': 'Todavía no tengo el formato de este proveedor. Si el PDF trae texto intento leerlo; si no, usa «registrar a mano» y envíame un PDF de ejemplo para configurarlo.'},
    {'id': 'puntoflex', 'nombre': 'Puntoflex · formato por configurar', 'pendiente': True, 'ayuda': 'Todavía no tengo el formato de este proveedor. Si el PDF trae texto intento leerlo; si no, usa «registrar a mano» y envíame un PDF de ejemplo para configurarlo.'},
    {'id': 'spirit', 'nombre': 'Spirit · formato por configurar', 'pendiente': True, 'ayuda': 'Todavía no tengo el formato de este proveedor. Si el PDF trae texto intento leerlo; si no, usa «registrar a mano» y envíame un PDF de ejemplo para configurarlo.'},
    {'id': 'manual', 'nombre': 'Otro proveedor · registrar a mano', 'ayuda': 'No lee el documento: eliges la tela y escribes los metros de cada rollo.'},
]
FORMATOS_IDS = {f['id'] for f in FORMATOS}
FORMATOS_PENDIENTES = {f['id']: f['nombre'].split(' · ')[0] for f in FORMATOS if f.get('pendiente')}


def parse_document(data: bytes, filename: str, formato: str = 'auto') -> dict:
    formato = formato if formato in FORMATOS_IDS else 'auto'
    if formato == 'manual':
        return {'proveedor': '', 'fecha': '', 'total_documento': None, 'tipo': 'manual',
                'lineas': [{'descripcion': 'Tela a registrar', 'referencia': '', 'rollos': []}]}
    if (formato in ('auto', 'lindatextil') or formato in FORMATOS_PENDIENTES) and data[:4] == b'%PDF':
        invoice = parse_invoice_text(data)
        if invoice:
            return invoice
    if formato in FORMATOS_PENDIENTES:
        raise ValueError(f'Todavía no tengo configurado el formato de {FORMATOS_PENDIENTES[formato]}. Envíame un PDF de ejemplo de ese proveedor para configurarlo; mientras tanto elige «Otro proveedor · registrar a mano».')
    if formato in ('auto', 'lindatextil'):
        empaque = parse_packing_list(data, filename)
        if empaque:
            return empaque
        if formato == 'lindatextil':
            raise ValueError('No reconocí un documento de Lindatextil (lista de empaque o factura electrónica). Revisa que la foto o el escaneo se vea completo y derecho, o elige otro formato.')
    try:
        return parse_eliot(data, filename)
    except Exception as exc:
        raise ValueError('No pude leer este documento como nota de entrega de Manufacturas Eliot. Revisa que el proveedor elegido sea el correcto.') from exc


def parse_eliot(data: bytes, filename: str) -> dict:
    pages = [parse_page(image) for image in load_images(data, filename)]
    merged = {'proveedor': '', 'fecha': '', 'total_documento': None, 'filas': []}
    for page in pages:
        merged['proveedor'] = merged['proveedor'] or page['proveedor']
        merged['fecha'] = merged['fecha'] or page['fecha']
        if page['total_documento'] is not None:
            merged['total_documento'] = (merged['total_documento'] or 0) + page['total_documento']
        merged['filas'].extend(page['filas'])
    groups: dict[str, dict] = {}
    for row in merged['filas']:
        row['descripcion'] = re.sub(r'[^\w\s/.()-]+', ' ', row['descripcion']).strip()
    # Variantes del OCR del mismo nombre (SUDAFRICASEC, subarricasec…) se unen a la más repetida.
    counts = Counter(norm(re.sub(r'-\s*\d+\s*$', '', row['descripcion'])) for row in merged['filas'])
    canonical = [name for name, _ in counts.most_common()]
    def group_key(text: str) -> str:
        key = norm(re.sub(r'-\s*\d+\s*$', '', text))
        compact = key.replace(' ', '')
        for name in canonical:
            if name == key or SequenceMatcher(None, compact, name.replace(' ', '')).ratio() >= 0.8:
                return name
        return key
    for row in merged['filas']:
        key = group_key(row['descripcion'])
        group = groups.get(key)
        if group is None:
            source = next((r for r in merged['filas'] if norm(re.sub(r'-\s*\d+\s*$', '', r['descripcion'])) == key), row)
            group = groups[key] = {'descripcion': source['descripcion'], 'referencia': source['referencia'], 'rollos': []}
        group['rollos'].append({'mts': row['mts'], 'rollo_no': row['rollo_no']})
    return {'proveedor': merged['proveedor'], 'fecha': merged['fecha'], 'total_documento': merged['total_documento'],
            'lineas': list(groups.values())}


def suggest_items(description: str, items: list[dict]) -> list[dict]:
    """Telas del inventario más parecidas a la descripción del documento."""
    tokens = set(re.findall(r'[A-Z]{3,}', norm(re.sub(r'-\s*\d+\s*$', '', description))))
    scored = []
    for item in items:
        name = norm(re.sub(r'^\s*\(\d+\)\s*', '', item['nombre']))
        item_tokens = set(re.findall(r'[A-Z]{3,}', name))
        if not item_tokens:
            continue
        common = tokens & item_tokens
        if not common:
            continue
        scored.append((len(common) / len(item_tokens) + 0.01 * len(common), item['nombre']))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [{'nombre': name, 'score': round(score, 2)} for score, name in scored[:5]]
