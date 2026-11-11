"""Lectura segura del archivo de control de confección para el panel.

El Excel nunca se edita: se toma como fuente de solo lectura y se recalcula al
cambiar su fecha de modificación en el servidor.
"""
from __future__ import annotations

import os
from collections import defaultdict
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


def _day(value):
    """Convierte fechas de Excel a fecha sin perder compatibilidad con celdas vacías."""
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def _weighted_days(rows: list[dict]) -> float | None:
    timed = [row for row in rows if row['duration'] is not None and row['received'] > 0]
    if not timed:
        return None
    total_units = sum(row['received'] for row in timed)
    return round(sum(row['duration'] * row['received'] for row in timed) / total_units, 1)


def _clean_label(value, fallback: str) -> str:
    label = ' '.join(str(value or '').split())
    return label[:72] if label else fallback


def _read(path: Path) -> dict:
    book = load_workbook(path, read_only=True, data_only=True)
    makers = []
    all_rows = []
    for sheet_name, label in SHEETS:
        if sheet_name not in book.sheetnames:
            continue
        sheet = book[sheet_name]
        rows = []
        for values in sheet.iter_rows(min_col=2, max_col=12, values_only=True):
            _client, _quote, reference, description, sent_date, received_date, sent, received, unit_value, value, payment = values
            if not (_is_2026(sent_date) or _is_2026(received_date)):
                continue
            sent, received, unit_value, value = map(_number, (sent, received, unit_value, value))
            if not any((sent, received, unit_value, value)):
                continue
            amount = value or received * unit_value
            sent_day, received_day = _day(sent_date), _day(received_date)
            duration = (received_day - sent_day).days if sent_day and received_day and received_day >= sent_day else None
            rows.append({
                'maker': label, 'sent': sent, 'received': received, 'amount': amount,
                'paid': _paid(payment), 'duration': duration, 'sent_date': sent_day,
                'received_date': received_day, 'description': _clean_label(description, 'Sin descripción'),
                'reference': _clean_label(reference, ''),
            })
        if not rows:
            continue
        sent = sum(row['sent'] for row in rows)
        received = sum(row['received'] for row in rows)
        amount = sum(row['amount'] for row in rows)
        paid = sum(row['amount'] for row in rows if row['paid'])
        makers.append({
            'name': label, 'orders': len(rows), 'sent': round(sent), 'received': round(received),
            'pending_units': round(max(0, sent - received)), 'amount': round(amount),
            'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(rows),
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'average_value_per_unit': round(amount / received) if received else None,
        })
        all_rows.extend(rows)
    if not makers:
        raise ValueError('El archivo no tiene registros 2026 de las hojas de confección configuradas.')
    sent = sum(row['sent'] for row in all_rows)
    received = sum(row['received'] for row in all_rows)
    amount = sum(row['amount'] for row in all_rows)
    paid = sum(row['amount'] for row in all_rows if row['paid'])
    monthly = defaultdict(lambda: {'sent': 0.0, 'received': 0.0, 'amount': 0.0})
    products = defaultdict(lambda: {'units': 0.0, 'amount': 0.0})
    pending = []
    for row in all_rows:
        if row['sent_date'] and row['sent_date'].year == YEAR:
            monthly[row['sent_date'].month]['sent'] += row['sent']
            monthly[row['sent_date'].month]['amount'] += row['amount']
        if row['received_date'] and row['received_date'].year == YEAR:
            monthly[row['received_date'].month]['received'] += row['received']
        products[row['description']]['units'] += row['received']
        products[row['description']]['amount'] += row['amount']
        if row['sent'] > row['received']:
            age_days = max(0, (date.today() - row['sent_date']).days) if row['sent_date'] else None
            pending.append({
                'maker': row['maker'], 'units': round(row['sent'] - row['received']),
                'sent_date': row['sent_date'].isoformat() if row['sent_date'] else None,
                'age_days': age_days, 'product': row['description'], 'reference': row['reference'],
            })

    monthly_data = [
        {'month': month, **{key: round(value) for key, value in monthly[month].items()}}
        for month in range(1, 13)
    ]
    products_data = [
        {'name': name, 'units': round(values['units']), 'amount': round(values['amount'])}
        for name, values in products.items() if values['units'] or values['amount']
    ]
    return {
        'year': YEAR, 'source_updated_at': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        'summary': {
            'orders': len(all_rows), 'sent': round(sent), 'received': round(received), 'pending_units': round(max(0, sent - received)),
            'amount': round(amount), 'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(all_rows), 'average_order_units': round(sent / len(all_rows), 1),
            'average_value_per_unit': round(amount / received) if received else None,
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'payment_marked_rate': round(paid / amount * 100, 1) if amount else None,
        },
        'makers': sorted(makers, key=lambda item: item['amount'], reverse=True),
        'monthly': monthly_data,
        'products': sorted(products_data, key=lambda item: item['units'], reverse=True)[:8],
        'pending': sorted(pending, key=lambda item: (item['age_days'] or 0, item['units']), reverse=True),
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
