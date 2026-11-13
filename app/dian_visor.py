"""Visor de facturas DIAN: solo LEE los XML ya guardados en la NAS.

No participa en la descarga ni modifica archivos. Entiende el XML UBL 2.1 de la
DIAN (Invoice, CreditNote, DebitNote) y el contenedor AttachedDocument que trae
la factura dentro de un CDATA.
"""
from __future__ import annotations

import io
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font

from app import dian

router = APIRouter(prefix='/api/dian/visor', tags=['dian-visor'])
MAX_FILES = 5000
MAX_XML_BYTES = 8 * 1024 * 1024
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
TIPOS = {'Invoice': 'Factura electrónica', 'CreditNote': 'Nota crédito', 'DebitNote': 'Nota débito'}


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _child(node, name):
    if node is None:
        return None
    return next((c for c in node if _local(c.tag) == name), None)


def _path(node, *names):
    for name in names:
        node = _child(node, name)
        if node is None:
            return None
    return node


def _text(node, *names) -> str:
    found = _path(node, *names) if names else node
    return (found.text or '').strip() if found is not None else ''


def _num(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _find_invoice(root):
    """Devuelve el nodo Invoice/CreditNote/DebitNote, aun dentro de AttachedDocument."""
    if _local(root.tag) in TIPOS:
        return root
    for node in root.iter():
        if _local(node.tag) == 'Description' and node.text and ('<Invoice' in node.text or '<CreditNote' in node.text or '<DebitNote' in node.text):
            inner = ET.fromstring(node.text.strip().encode('utf-8'))
            if _local(inner.tag) in TIPOS:
                return inner
    return None


def _party(node, name) -> dict:
    party = _path(node, name, 'Party')
    tax = _child(party, 'PartyTaxScheme')
    legal = _child(party, 'PartyLegalEntity')
    nit = _text(tax, 'CompanyID') or _text(legal, 'CompanyID')
    nombre = _text(tax, 'RegistrationName') or _text(legal, 'RegistrationName') or _text(_path(party, 'PartyName'), 'Name')
    return {'nit': nit, 'nombre': nombre}


def _impuestos(root) -> tuple[float, float]:
    """IVA informado y retenciones del documento (totales a nivel de factura)."""
    iva = ret = 0.0
    for child in root:
        name = _local(child.tag)
        if name not in ('TaxTotal', 'WithholdingTaxTotal'):
            continue
        amount = _num(_text(child, 'TaxAmount'))
        if name == 'WithholdingTaxTotal':
            ret += amount
            continue
        codes = {_text(sub, 'TaxCategory', 'TaxScheme', 'ID') for sub in child if _local(sub.tag) == 'TaxSubtotal'}
        if not codes or '01' in codes:
            iva += amount
    return iva, ret


def parse_xml(data: bytes) -> dict | None:
    if len(data) > MAX_XML_BYTES:
        return None
    try:
        root = _find_invoice(ET.fromstring(data))
    except ET.ParseError:
        return None
    if root is None:
        return None
    tipo = _local(root.tag)
    total = _path(root, 'LegalMonetaryTotal')
    if total is None:
        total = _path(root, 'RequestedMonetaryTotal')
    iva, ret = _impuestos(root)
    moneda = _text(root, 'DocumentCurrencyCode') or 'COP'
    lineas = []
    for line in root:
        if _local(line.tag) not in ('InvoiceLine', 'CreditNoteLine', 'DebitNoteLine'):
            continue
        item = _child(line, 'Item')
        line_tax = _child(line, 'TaxTotal')
        lineas.append({
            'linea': _text(line, 'ID'),
            'sku': _text(item, 'SellersItemIdentification', 'ID') or _text(item, 'StandardItemIdentification', 'ID'),
            'descripcion': _text(item, 'Description') or _text(item, 'Name'),
            'cantidad': _num(_text(line, 'InvoicedQuantity') or _text(line, 'CreditedQuantity') or _text(line, 'DebitedQuantity')),
            'base': _num(_text(line, 'LineExtensionAmount')),
            'iva': _num(_text(line_tax, 'TaxAmount')) if line_tax is not None else 0.0,
        })
    uuid = _text(root, 'UUID')
    return {
        'tipo': TIPOS[tipo], 'tipo_xml': tipo,
        'descripcion': _text(root, 'ProfileID'),
        'numero': _text(root, 'ID'), 'cufe': uuid,
        'fecha': _text(root, 'IssueDate'), 'vence': _text(root, 'DueDate'),
        'emisor': _party(root, 'AccountingSupplierParty'),
        'receptor': _party(root, 'AccountingCustomerParty'),
        'moneda': moneda,
        'base': _num(_text(total, 'LineExtensionAmount')),
        'base_gravable': _num(_text(total, 'TaxExclusiveAmount')),
        'iva': iva, 'retenciones': ret,
        'total': _num(_text(total, 'PayableAmount')),
        'lineas': lineas,
    }


def _resumen(info: dict) -> dict:
    return {k: v for k, v in info.items() if k != 'lineas'} | {'items': len(info['lineas'])}


def _infos(folder: Path) -> list[tuple[str, dict]]:
    """Pares (archivo relativo, factura completa) de la carpeta, con caché por fecha de cambio."""
    root = dian._root.resolve()
    out = []
    for item in sorted(folder.rglob('*.xml'))[:MAX_FILES]:
        try:
            stat = item.stat()
            key = str(item)
            with _lock:
                hit = _cache.get(key)
            if hit and hit[0] == stat.st_mtime:
                info = hit[1]
            else:
                info = parse_xml(item.read_bytes())
                with _lock:
                    _cache[key] = (stat.st_mtime, info or {})
            if info:
                out.append((item.relative_to(root).as_posix(), info))
        except OSError:
            continue
    return out


def _scan(folder: Path) -> list[dict]:
    return [_resumen(info) | {'archivo': rel} for rel, info in _infos(folder)]


def _cell(value):
    """Evita que un texto del XML se abra en Excel como fórmula."""
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@'):
        return "'" + value
    return value


def _sheet(wb, title: str, headers: list[str], rows: list[list]) -> None:
    ws = wb.create_sheet(title[:31])
    ws.append(headers)
    for row in rows:
        ws.append([_cell(value) for value in row])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions


def _third_party(items: list[tuple[str, dict]], side: str) -> list[list]:
    totals: dict[tuple[str, str], dict] = {}
    for _, info in items:
        if info['tipo_xml'] != 'Invoice':
            continue
        party = info[side]
        key = (party['nit'], party['nombre'])
        acc = totals.setdefault(key, {'n': 0, 'base': 0.0, 'iva': 0.0, 'total': 0.0})
        acc['n'] += 1
        acc['base'] += info['base']
        acc['iva'] += info['iva']
        acc['total'] += info['total']
    return [[nit, nombre, acc['n'], acc['base'], acc['iva'], acc['total']]
            for (nit, nombre), acc in sorted(totals.items(), key=lambda kv: -kv[1]['total'])]


@router.get('/excel')
def excel(carpeta: str = ''):
    """Excel con las mismas pestañas del visor, generado desde los XML guardados."""
    folder = _inside(carpeta)
    if not folder.is_dir():
        raise HTTPException(404, 'No hay facturas en esa carpeta.')
    items = _infos(folder)
    facturas = [(rel, info) for rel, info in items if info['tipo_xml'] == 'Invoice']
    wb = Workbook()
    wb.remove(wb.active)
    _sheet(wb, 'Reporte general',
           ['Número', 'Tipo', 'Fecha', 'Vence', 'CUFE', 'NIT emisor', 'Emisor', 'NIT receptor', 'Receptor',
            'Base', 'IVA', 'Retenciones', 'Total', 'Moneda', 'Líneas', 'Archivo'],
           [[i['numero'], i['tipo'], i['fecha'], i['vence'], i['cufe'], i['emisor']['nit'], i['emisor']['nombre'],
             i['receptor']['nit'], i['receptor']['nombre'], i['base'], i['iva'], i['retenciones'], i['total'],
             i['moneda'], len(i['lineas']), rel] for rel, i in items])
    _sheet(wb, 'Detalle por línea',
           ['Número', 'Fecha', 'NIT emisor', 'Emisor', 'NIT receptor', 'Receptor', 'Línea', 'SKU', 'Descripción',
            'Cantidad', 'Base', 'IVA'],
           [[i['numero'], i['fecha'], i['emisor']['nit'], i['emisor']['nombre'], i['receptor']['nit'],
             i['receptor']['nombre'], l['linea'], l['sku'], l['descripcion'], l['cantidad'], l['base'], l['iva']]
            for _, i in items for l in i['lineas']])
    _sheet(wb, 'Retenciones',
           ['Número', 'Fecha', 'NIT emisor', 'Emisor', 'Base', 'Retenciones', 'Total'],
           [[i['numero'], i['fecha'], i['emisor']['nit'], i['emisor']['nombre'], i['base'], i['retenciones'], i['total']]
            for _, i in items if i['retenciones']])
    _sheet(wb, 'Terceros emisor', ['NIT', 'Nombre', 'Facturas', 'Base', 'IVA', 'Total'], _third_party(items, 'emisor'))
    _sheet(wb, 'Terceros receptor', ['NIT', 'Nombre', 'Facturas', 'Base', 'IVA', 'Total'], _third_party(items, 'receptor'))
    _sheet(wb, 'Detalle de notas',
           ['Número', 'Tipo', 'Fecha', 'NIT emisor', 'Emisor', 'NIT receptor', 'Receptor', 'Base', 'IVA', 'Total'],
           [[i['numero'], i['tipo'], i['fecha'], i['emisor']['nit'], i['emisor']['nombre'], i['receptor']['nit'],
             i['receptor']['nombre'], i['base'], i['iva'], i['total']]
            for _, i in items if i['tipo_xml'] != 'Invoice'])
    buffer = io.BytesIO()
    wb.save(buffer)
    return Response(content=buffer.getvalue(),
                    media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="facturas_dian.xlsx"'})


def _inside(raw: str) -> Path:
    root = dian._root.resolve()
    clean = str(raw or '').replace('\\', '/').strip('/')
    if '..' in clean.split('/'):
        raise HTTPException(400, 'Ruta no permitida.')
    target = (root / clean).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(400, 'Ruta no permitida.')
    return target


@router.get('/facturas')
def facturas(carpeta: str = ''):
    folder = _inside(carpeta)
    if not folder.is_dir():
        return {'facturas': [], 'carpeta': carpeta, 'truncado': False}
    rows = _scan(folder)
    rows.sort(key=lambda r: (r['fecha'], r['numero']), reverse=True)
    return {'facturas': rows, 'carpeta': carpeta, 'truncado': len(rows) >= MAX_FILES,
            'actualizado': datetime.now(timezone.utc).replace(microsecond=0).isoformat()}


@router.get('/factura')
def factura(archivo: str):
    target = _inside(archivo)
    if target.suffix.lower() != '.xml' or not target.is_file():
        raise HTTPException(404, 'Factura no disponible.')
    info = parse_xml(target.read_bytes())
    if not info:
        raise HTTPException(422, 'Ese XML no es una factura DIAN legible.')
    info['archivo'] = target.relative_to(dian._root.resolve()).as_posix()
    return info
