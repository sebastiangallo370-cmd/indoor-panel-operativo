"""Lectura de notas de entrega (PDF o imagen) para proponer ingresos de tela.

El OCR se usa solo para proponer datos: el usuario revisa y confirma antes de registrar nada.
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import tempfile
import unicodedata
from collections import defaultdict

import pdfplumber
from PIL import Image, ImageOps

MAX_PAGES = 5
NUMBER = re.compile(r'\d+(?:\.\d+)?')


def norm(value) -> str:
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(char for char in text if unicodedata.category(char) != 'Mn')
    return re.sub(r'\s+', ' ', text.upper()).strip()


def _tesseract(path: str, *args: str, timeout: int = 180) -> str:
    result = subprocess.run(['tesseract', path, 'stdout', *args], capture_output=True, text=True, timeout=timeout)
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
        tsv = _tesseract(path, '-l', 'spa+eng', '--psm', '6', 'tsv')
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


def _first(words: list[dict], *names: str) -> dict | None:
    wanted = {norm(n) for n in names}
    return next((w for w in words if norm(w['text']).strip('.:') in wanted), None)


def parse_page(image: Image.Image) -> dict:
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
    for ws in ordered:
        top, bottom = min(w['top'] for w in ws), max(w['bottom'] for w in ws)
        if top <= header_bottom:
            continue
        joined = norm(' '.join(w['text'] for w in ws))
        in_desc = ' '.join(w['text'] for w in sorted(ws, key=lambda w: w['left']) if desc_box[0] <= (w['left'] + w['right']) / 2 <= desc_box[1])
        is_total = any(key in joined for key in ('TOTAL', 'BULTO', 'ROLLOS'))
        if is_total:
            finished = True
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
    return result


def parse_document(data: bytes, filename: str) -> dict:
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
        key = norm(re.sub(r'-\s*\d+\s*$', '', row['descripcion']))
        group = groups.setdefault(key, {'descripcion': row['descripcion'], 'referencia': row['referencia'], 'rollos': []})
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
