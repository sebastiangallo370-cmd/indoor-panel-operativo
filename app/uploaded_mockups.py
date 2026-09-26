"""Attach order uploads to listing drawings without rewriting cells or styles."""
import hashlib
import io
import os
from pathlib import Path
import posixpath
import re
import shutil
import tempfile
import unicodedata
import zipfile
from xml.etree import ElementTree as ET

from PIL import Image

S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
X = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}


async def require_mockup_upload(uploads):
    """Validate actual image bytes before accepting a programming job."""
    images = [item for item in uploads if Path(item.filename or '').suffix.lower() in IMAGE_EXTENSIONS]
    if not images:
        raise ValueError('Debes adjuntar al menos un mockup JPG, PNG o WEBP para programar la orden.')
    for item in images:
        data = await item.read(10 * 1024 * 1024 + 1)
        await item.seek(0)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError('El mockup supera 10 MB: ' + item.filename)
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > 25_000_000:
                    raise ValueError('Demasiados píxeles')
                image.verify()
        except Exception as exc:
            raise ValueError('El mockup no es una imagen válida: ' + item.filename) from exc


def normalized(text):
    value = unicodedata.normalize('NFKD', str(text)).upper()
    return re.sub('[^A-Z0-9]+', ' ', ''.join(c for c in value if not unicodedata.combining(c))).strip()


def match_uploads(paths, references):
    """Never infer across different reference sheets. Preserve all D1-D4 uploads."""
    result, issues = {}, []
    refs = list(references)
    for path in sorted(map(Path, paths), key=lambda p: normalized(p.name)):
        if path.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}:
            continue
        name = normalized(path.stem)
        matches = [ref for ref in refs if normalized(ref) in name]
        codes = re.findall(r'(?<![A-Z0-9])([A-Z]{2,5}\d{2,3})(?![A-Z0-9])', name)
        if not matches:
            # Recognize conventional short codes such as FUT01_D1.
            matches = [ref for ref in refs if any(code in normalized(ref) for code in codes)]
        if len(refs) == 1:
            matches = refs
        if len(matches) != 1:
            issues.append(path.name + ': indicar referencia en el nombre')
            continue
        ref = matches[0]
        found = re.search(r'(?:^| )(?:D|DISENO)\s*([1-4])(?: |$)', name)
        slots = result.setdefault(ref, {})
        design = int(found[1]) if found and int(found[1]) not in slots else next((n for n in range(1, 5) if n not in slots), None)
        if design is None or design in slots:
            raise ValueError('Máximo cuatro diseños distintos por referencia; revisar ' + path.name)
        if path.is_symlink() or path.stat().st_size > 10 * 1024 * 1024:
            raise ValueError('Imagen no válida o demasiado grande: ' + path.name)
        with Image.open(path) as image:
            if image.width * image.height > 25_000_000:
                raise ValueError('Imagen demasiado grande: ' + path.name)
            output = io.BytesIO()
            image.convert('RGB').save(output, format='PNG')
            if output.tell() > 10 * 1024 * 1024:
                raise ValueError('Imagen demasiado grande para el listado: ' + path.name)
            slots[design] = (path, output.getvalue(), image.width, image.height)
    if sum(len(item[1]) for slots in result.values() for item in slots.values()) > 16 * 1024 * 1024:
        raise ValueError('El conjunto de mockups supera 16 MB')
    return result, issues


def embed_uploads(workbook_path, paths, backup_dir, missing_only=False):
    """Atomic ZIP edit. Existing Excel content remains byte-for-byte unchanged
    except drawing, relationship and content-type XML; original is backed up.
    """
    workbook_path = Path(workbook_path)
    if workbook_path.is_symlink() or workbook_path.suffix.lower() not in {'.xlsx', '.xlsm'}:
        raise ValueError('Listado no válido')
    before = workbook_path.stat()
    if before.st_size > 30 * 1024 * 1024:
        raise ValueError('Listado demasiado grande')
    with zipfile.ZipFile(workbook_path) as source:
        if sum(i.file_size for i in source.infolist()) > 150 * 1024 * 1024:
            raise ValueError('Listado demasiado grande')
        entries = {info.filename: source.read(info.filename) for info in source.infolist()}
    def xml(part):
        data = entries[part]
        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
            raise ValueError('XML no permitido')
        return ET.fromstring(data)
    def relpart(part):
        return posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
    def rels(part):
        return xml(relpart(part)) if relpart(part) in entries else ET.Element('{'+P+'}Relationships')
    def resolve(part, target):
        return posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part), target))
    def target_for(part, relationships, identifier):
        return next((resolve(part, rel.get('Target', '')) for rel in relationships if rel.get('Id') == identifier and rel.get('TargetMode') != 'External'), None)
    def save(part, node):
        entries[part] = ET.tostring(node, encoding='utf-8', xml_declaration=True)
    book = xml('xl/workbook.xml')
    sheets = {s.get('name'): s for s in book.findall('{'+S+'}sheets/{'+S+'}sheet') if s.get('state', 'visible') == 'visible' and s.get('name', '').upper() != 'BASE_DATOS'}
    assignments, issues = match_uploads(paths, sheets)
    if issues and not missing_only:
        raise ValueError('No se insertaron las imágenes: ' + ' | '.join(issues))
    book_rels = rels('xl/workbook.xml')
    content = xml('[Content_Types].xml')
    inserted = 0
    for name, designs in assignments.items():
        part = target_for('xl/workbook.xml', book_rels, sheets[name].get('{'+R+'}id'))
        if not part or part not in entries:
            raise ValueError('Hoja no disponible: ' + name)
        sheet = xml(part)
        sheet_rels = rels(part)
        drawing_tag = sheet.find('{'+S+'}drawing')
        drawing_part = target_for(part, sheet_rels, drawing_tag.get('{'+R+'}id')) if drawing_tag is not None else None
        if drawing_tag is not None and not drawing_part:
            raise ValueError('Relación de dibujo no válida')
        if drawing_part:
            drawing = xml(drawing_part)
        else:
            token = hashlib.sha256(part.encode()).hexdigest()[:16]
            drawing_part = 'xl/drawings/indoor_' + token + '.xml'
            identifier = 'rIdIndoorMockups'
            if any(rel.get('Id') == identifier for rel in sheet_rels):
                raise ValueError('Relación duplicada')
            ET.SubElement(sheet_rels, '{'+P+'}Relationship', Id=identifier, Type=R+'/drawing', Target=posixpath.relpath(drawing_part, posixpath.dirname(part)))
            drawing_tag = ET.Element('{'+S+'}drawing', {'{'+R+'}id': identifier})
            # Spreadsheet schema: drawings precede legacyDrawing/tableParts/extLst.
            later = {'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'}
            index = next((i for i, item in enumerate(sheet) if item.tag.split('}')[-1] in later), len(sheet))
            sheet.insert(index, drawing_tag)
            save(part, sheet)
            save(relpart(part), sheet_rels)
            drawing = ET.Element('{'+X+'}wsDr')
            ET.SubElement(content, '{'+C+'}Override', PartName='/'+drawing_part, ContentType='application/vnd.openxmlformats-officedocument.drawing+xml')
        existing = {}
        for anchor in drawing:
            marker = anchor.find('{'+X+'}from')
            if marker is not None:
                col = int(marker.findtext('{'+X+'}col', '-1'))
                row = int(marker.findtext('{'+X+'}row', '-1'))
                if 17 <= col <= 42 and 0 <= row <= 100:
                    existing.setdefault(min(4, max(1, round((col-18)/6)+1)), []).append(anchor)
        image_rels = rels(drawing_part)
        for design, (path, data, width, height) in designs.items():
            if missing_only and existing:
                continue
            for previous in existing.get(design, []):
                drawing.remove(previous)
            digest = hashlib.sha256(data).hexdigest()
            media = 'xl/media/indoor_' + digest + '.png'
            entries[media] = data
            rid = 'rIdIndoor' + digest[:20] + str(design)
            if not any(rel.get('Id') == rid for rel in image_rels):
                ET.SubElement(image_rels, '{'+P+'}Relationship', Id=rid, Type=R+'/image', Target=posixpath.relpath(media, posixpath.dirname(drawing_part)))
            anchor = ET.SubElement(drawing, '{'+X+'}oneCellAnchor')
            marker = ET.SubElement(anchor, '{'+X+'}from')
            for key, value in [('col', 18+(design-1)*6), ('colOff', 0), ('row', 2), ('rowOff', 0)]:
                ET.SubElement(marker, '{'+X+'}'+key).text = str(value)
            scale = min(330/width, 620/height)
            ET.SubElement(anchor, '{'+X+'}ext', cx=str(int(width*scale*9525)), cy=str(int(height*scale*9525)))
            picture = ET.SubElement(anchor, '{'+X+'}pic')
            props = ET.SubElement(picture, '{'+X+'}nvPicPr')
            ids = [int(node.get('id', '0')) for node in drawing.iter('{'+X+'}cNvPr')]
            ET.SubElement(props, '{'+X+'}cNvPr', id=str(max(ids, default=0)+1), name=f'D{design} · {path.name}')
            ET.SubElement(props, '{'+X+'}cNvPicPr')
            fill = ET.SubElement(picture, '{'+X+'}blipFill')
            ET.SubElement(fill, '{'+A+'}blip', {'{'+R+'}embed': rid})
            ET.SubElement(ET.SubElement(fill, '{'+A+'}stretch'), '{'+A+'}fillRect')
            shape = ET.SubElement(picture, '{'+X+'}spPr')
            ET.SubElement(ET.SubElement(shape, '{'+A+'}prstGeom', prst='rect'), '{'+A+'}avLst')
            ET.SubElement(anchor, '{'+X+'}clientData')
            inserted += 1
        save(drawing_part, drawing)
        save(relpart(drawing_part), image_rels)
    if not inserted:
        return 0, issues
    if not any(node.get('Extension') == 'png' for node in content):
        ET.SubElement(content, '{'+C+'}Default', Extension='png', ContentType='image/png')
    save('[Content_Types].xml', content)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    identity = hashlib.sha256((str(workbook_path.resolve())+str(before.st_mtime_ns)).encode()).hexdigest()
    backup = backup_dir / (identity + workbook_path.suffix)
    if not backup.exists():
        shutil.copy2(workbook_path, backup)
    fd, temporary = tempfile.mkstemp(prefix='.indoor-mockups-', suffix=workbook_path.suffix, dir=workbook_path.parent)
    try:
        with os.fdopen(fd, 'wb') as output, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
            for name, data in entries.items():
                target.writestr(name, data)
        current = workbook_path.stat()
        if (current.st_size, current.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            raise OSError('El listado cambió durante la inserción; vuelve a intentarlo')
        os.replace(temporary, workbook_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return inserted, issues


def sync_order_uploads(order_dir, backup_dir, missing_only=False, uploaded_names=None):
    order_dir = Path(order_dir)
    files = [p for p in order_dir.iterdir() if p.is_file() and not p.is_symlink() and not p.name.startswith(('~$', '.'))]
    listings = [p for p in files if p.suffix.lower() in {'.xlsx', '.xlsm'}]
    canonical = [p for p in listings if p.stem.casefold() == order_dir.name.casefold()]
    if len(canonical) == 1:
        listings = canonical
    if len(listings) != 1:
        return 0, ['No hay un único listado Excel en la orden']
    images = files if uploaded_names is None else [p for p in files if p.name in uploaded_names]
    return embed_uploads(listings[0], images, backup_dir, missing_only)
