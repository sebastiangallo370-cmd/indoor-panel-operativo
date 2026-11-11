"""Lectura segura del archivo de control de confección para el panel.

El Excel nunca se edita: se toma como fuente de solo lectura y se recalcula al
cambiar su fecha de modificación en el servidor.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, HTTPException
from openpyxl import load_workbook

router = APIRouter()
YEAR = 2026
DEFAULT_FILE = '/data/CONFECCIONES_2026_CONFECCION.xlsx'

# Son las hojas activas que componen el control 2026 entregado por el usuario.
SHEETS = (
    ('yenni monsalve confec', 'Yenni Monsalve'),
    ('alba confeccion', 'Alba Confección'),
    ('noelia ciro confec', 'Noelia Ciro'),
    ('liliana marin conf', 'Liliana Marín'),
    ('omaira bergara conf', 'Omaira Bergara'),
    ('juan esteban confecc', 'Juan Esteban'),
    ('Blanca emilce', 'Blanca Emilce'),
    ('madelin tulas', 'Madelin Tulas'),
    ('Aida.Unifo', 'Aida'),
)
_cache: dict = {'mtime': None, 'data': None}
_lock = Lock()


def _source() -> Path:
    return Path(os.getenv('CONFECCION_EXCEL_PATH', DEFAULT_FILE))


def _number(value) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _is_2026(value) -> bool:
    return isinstance(value, (datetime, date)) and value.year == YEAR


def _paid(value) -> bool:
    """Una fecha, 'cancelado' o un valor en la columna de pago marca el renglón pagado."""
    if isinstance(value, (datetime, date)):
        return True
    return bool(str(value or '').strip())


def _read(path: Path) -> dict:
    book = load_workbook(path, read_only=True, data_only=True)
    makers = []
    all_rows = []
    for sheet_name, label in SHEETS:
        if sheet_name not in book.sheetnames:
            continue
        sheet = book[sheet_name]
        rows = []
        for values in sheet.iter_rows(min_col=6, max_col=12, values_only=True):
            sent_date, received_date, sent, received, unit_value, value, payment = values
            if not (_is_2026(sent_date) or _is_2026(received_date)):
                continue
            sent, received, unit_value, value = map(_number, (sent, received, unit_value, value))
            if not any((sent, received, unit_value, value)):
                continue
            amount = value or received * unit_value
            duration = (received_date - sent_date).days if isinstance(sent_date, datetime) and isinstance(received_date, datetime) and received_date >= sent_date else None
            rows.append({'sent': sent, 'received': received, 'amount': amount, 'paid': _paid(payment), 'duration': duration})
        if not rows:
            continue
        sent = sum(row['sent'] for row in rows)
        received = sum(row['received'] for row in rows)
        amount = sum(row['amount'] for row in rows)
        paid = sum(row['amount'] for row in rows if row['paid'])
        timed = [row for row in rows if row['duration'] is not None and row['received'] > 0]
        makers.append({
            'name': label, 'orders': len(rows), 'sent': round(sent), 'received': round(received),
            'pending_units': round(max(0, sent - received)), 'amount': round(amount),
            'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': round(sum(row['duration'] * row['received'] for row in timed) / sum(row['received'] for row in timed), 1) if timed else None,
        })
        all_rows.extend(rows)
    if not makers:
        raise ValueError('El archivo no tiene registros 2026 de las hojas de confección configuradas.')
    sent = sum(row['sent'] for row in all_rows)
    received = sum(row['received'] for row in all_rows)
    amount = sum(row['amount'] for row in all_rows)
    paid = sum(row['amount'] for row in all_rows if row['paid'])
    timed = [row for row in all_rows if row['duration'] is not None and row['received'] > 0]
    return {
        'year': YEAR, 'source_updated_at': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        'summary': {
            'orders': len(all_rows), 'sent': round(sent), 'received': round(received), 'pending_units': round(max(0, sent - received)),
            'amount': round(amount), 'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': round(sum(row['duration'] * row['received'] for row in timed) / sum(row['received'] for row in timed), 1) if timed else None,
        },
        'makers': sorted(makers, key=lambda item: item['amount'], reverse=True),
    }


def get_data() -> dict:
    path = _source()
    if not path.is_file():
        raise FileNotFoundError(f'No se encontró el archivo de confección en {path.name}.')
    mtime = path.stat().st_mtime_ns
    with _lock:
        if _cache['mtime'] != mtime:
            _cache['data'] = _read(path)
            _cache['mtime'] = mtime
        return _cache['data']


@router.get('/api/contabilidad-confeccion')
def contabilidad_confeccion():
    try:
        return get_data()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, 'No se pudo leer el Excel de confección: ' + str(exc)[:180]) from exc
