"""Read embedded listing designs without modifying workbooks or following links."""
from functools import lru_cache
from contextlib import closing
from pathlib import Path
import posixpath
import re
import zipfile
import sqlite3
import json
import base64
import time
from xml.etree import ElementTree as ET
from app.settings import STATE_DIR

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'x': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}


def normalized(value):
    return re.sub(r'\s+', '', value).upper()


@lru_cache(maxsize=8)
def read_designs(filename, modified_ns, size, reference):
    """Persist previews across refreshes, memory eviction and server restarts."""
    cache_path = STATE_DIR / 'excel_mockup_cache.sqlite3'
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(cache_path, timeout=15)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS previews (filename TEXT, reference TEXT, version TEXT, payload TEXT, updated REAL, PRIMARY KEY(filename,reference))')
        version = f'2:{modified_ns}:{size}'
        row = db.execute('SELECT payload FROM previews WHERE filename=? AND reference=? AND version=?', (filename, reference, version)).fetchone()
    if row:
        try:
            saved = json.loads(row[0])
            return tuple((n, mime, base64.b64decode(data, validate=True)) for n, mime, data in saved['images']), saved['status']
        except (ValueError, KeyError, TypeError):
            pass
    images, status = extract_designs(filename, size, reference)
    # Never associate partially edited workbook bytes with an earlier version.
    current = Path(filename).stat()
    if (current.st_mtime_ns, current.st_size) != (modified_ns, size):
        raise OSError('El listado está cambiando; vuelve a intentarlo')
    payload = json.dumps({'images': [(n, mime, base64.b64encode(data).decode('ascii')) for n, mime, data in images], 'status': status})
    with closing(sqlite3.connect(cache_path, timeout=15)) as db, db:
        db.execute('INSERT OR REPLACE INTO previews VALUES (?,?,?,?,?)', (filename, reference, version, payload, time.time()))
    return images, status


def extract_designs(filename, size, reference):
    # Stat values are part of the key so updating a listing invalidates its cache.
    if size > 30 * 1024 * 1024:
        return (), 'Listado demasiado grande para vista previa'
    with zipfile.ZipFile(filename) as z:
        if len(z.infolist()) > 3000 or sum(i.file_size for i in z.infolist()) > 150 * 1024 * 1024:
            return (), 'Listado demasiado grande para vista previa'

        def read(name, limit=8 * 1024 * 1024):
            if z.getinfo(name).file_size > limit:
                raise ValueError('Entrada de Excel demasiado grande')
            return z.read(name)

        def xml(name):
            data = read(name)
            if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                raise ValueError('XML no permitido')
            return ET.fromstring(data)

        def relations(part):
            relfile = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
            if relfile not in z.namelist():
                return {}
            result = {}
            for rel in xml(relfile):
                if rel.get('TargetMode') == 'External':
                    continue
                target = rel.get('Target', '')
                resolved = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part), target))
                if resolved.startswith('xl/') and '\\' not in resolved:
                    result[rel.get('Id')] = resolved
            return result

        workbook = xml('xl/workbook.xml')
        wb_rels = relations('xl/workbook.xml')
        all_sheets = workbook.findall('s:sheets/s:sheet', NS)

        def sheet_candidates(sheet_el):
            """Return (candidates, unsupported) for one sheet element."""
            part = wb_rels.get(sheet_el.get('{'+NS['r']+'}id'))
            if not part:
                return [], False
            try:
                sheet_xml = xml(part)
            except Exception:
                return [], False
            sheet_rels = relations(part)
            items, bad = [], False
            for drawing in sheet_xml.findall('s:drawing', NS):
                drawing_part = sheet_rels.get(drawing.get('{'+NS['r']+'}id'))
                if not drawing_part:
                    continue
                image_rels = relations(drawing_part)
                try:
                    drawing_xml = xml(drawing_part)
                except Exception:
                    continue
                for anchor in drawing_xml:
                    marker = anchor.find('x:from', NS)
                    if marker is None:
                        continue
                    col = int(marker.findtext('x:col', '-1', NS))
                    row = int(marker.findtext('x:row', '-1', NS))
                    # Verified listing layout: designs start near S, logo lives at B.
                    if not 17 <= col <= 42 or not 0 <= row <= 100:
                        continue
                    blip = anchor.find('.//a:blip', NS)
                    if blip is None:
                        continue
                    media = image_rels.get(blip.get('{'+NS['r']+'}embed'))
                    if not media or not media.startswith('xl/media/'):
                        continue
                    if Path(media).suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp') or z.getinfo(media).file_size > 10 * 1024 * 1024:
                        bad = True
                        continue
                    data = read(media, 10 * 1024 * 1024)
                    mime = ('image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
                            'image/jpeg' if data.startswith(b'\xff\xd8\xff') else
                            'image/webp' if data[:4] == b'RIFF' and data[8:12] == b'WEBP' else None)
                    if mime is None:
                        bad = True
                        continue
                    # New templates have four six-column slots S/Y/AE/AK.
                    design = min(4, max(1, round((col - 18) / 6) + 1)) if row < 10 else None
                    items.append((row, col, design, mime, data))
            return items, bad

        # 1) Exact sheet-name match.
        matched = [s for s in all_sheets if normalized(s.get('name', '')) == normalized(reference)]
        # 2) Token-based match: any [A-Z]+\d+ code from the reference found in a sheet name.
        if len(matched) != 1:
            ref_tokens = set(re.findall(r'[A-Z]+\d+', reference.upper()))
            if ref_tokens:
                matched = [s for s in all_sheets
                           if any(t in normalized(s.get('name', '')) for t in ref_tokens)]
        # 3) Fallback: first sheet in workbook order that has images in the design area.
        if len(matched) != 1:
            matched = []
            for candidate in all_sheets:
                imgs, _ = sheet_candidates(candidate)
                if imgs:
                    matched = [candidate]
                    break

        if len(matched) != 1:
            return (), 'Sin hoja coincidente con la referencia'

        candidates, unsupported = sheet_candidates(matched[0])
        candidates.sort(key=lambda item: (item[1], item[0]))
        if sum(len(item[4]) for item in candidates) > 16 * 1024 * 1024:
            return (), 'Imágenes demasiado grandes para vista previa'
        if len(candidates) > 4:
            return (), 'Más de cuatro imágenes: revisar listado'
        result = []
        seen = set()
        for _, _, design, mime, data in candidates:
            number = design or len(result) + 1
            if number in seen:
                return (), 'Diseños superpuestos: revisar listado'
            seen.add(number)
            result.append((number, mime, data))
        return tuple(result), ('Imagen del Excel en formato no compatible' if unsupported else
                               '' if result else 'Sin imagen en la hoja del listado')


def listing_designs(files, reference):
    candidates = [p for p in files if p.suffix.lower() in ('.xlsx', '.xlsm') and not p.name.startswith('~$')]
    canonical = [p for p in candidates if p.stem.casefold() == p.parent.name.casefold()]
    if len(canonical) == 1:
        candidates = canonical
    if len(candidates) != 1:
        return (), 'Varios listados Excel: revisar archivo' if candidates else 'Sin listado Excel de la orden'
    path = candidates[0]
    stat = path.stat()
    images, status = read_designs(str(path), stat.st_mtime_ns, stat.st_size, reference)
    return images, status
