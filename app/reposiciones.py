"""Reposiciones y garantías: lee la pestaña REPOSICIONES-GARANTIAS del Sheet de producción (solo lectura)
y la entrega agrupada en casos (cliente + cotización + fecha) para las tarjetas del módulo Reproceso.
"""
import json
import logging
import os
import re
import threading
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter

router = APIRouter(prefix='/api/reposiciones', tags=['reposiciones'])
SHEET_ID = 940423036
SHEET_TITLE_HINT = 'GARANT'
FIRST_DATA_ROW = 4  # filas 1-3: título y encabezados
RANGE = 'A1:AD4000'
CACHE_SECONDS = 120
OLD_AFTER_DAYS = 60
_snapshot_file = Path(os.getenv('REPOSICIONES_SNAPSHOT', '/data/state/reposiciones_snapshot.json'))
_provider: Callable = lambda: None
_lock = threading.Lock()
_cache = {'at': 0.0, 'data': None}

# (clave, nombre, columna del valor, columna del responsable)
STEPS = [('edicion', 'Edición', 18, 17), ('impresion', 'Impresión', 21, None), ('sublimacion', 'Sublimación', 23, 24),
         ('laser', 'Corte láser', 25, 26), ('confeccion', 'Confección', 27, None), ('terminacion', 'Terminación', 28, None)]
MONTHS = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'sep': 9, 'sept': 9, 'set': 9, 'oct': 10, 'nov': 11, 'dic': 12}


def configurar(provider: Callable) -> None:
    global _provider
    _provider = provider


def _plain(text) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(text or '')) if not unicodedata.combining(c)).upper().strip()


def parse_date(text) -> date | None:
    t = _plain(text).replace('.', '').replace(' ', '')
    m = re.match(r'^(\d{1,2})[/-]([A-Z]{3,4})[/-](\d{2,4})', t)
    if m and m.group(2).lower() in MONTHS:
        day, month, year = int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))
    else:
        m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', t)
        if not m:
            return None
        a, b, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        day, month = (b, a) if a <= 12 < b else (a, b)
    year += 2000 if year < 100 else 0
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _done(value: str) -> bool:
    v = str(value or '').strip()
    return bool(v) and '❌' not in v


def _int(text) -> int:
    m = re.search(r'\d+', str(text or ''))
    return int(m.group()) if m else 0


def _tipo(reason: str) -> str:
    r = _plain(reason)
    if 'GARANT' in r:
        return 'garantia'
    if 'REPOSICION CLIENTE' in r or r == 'PEDIDO':
        return 'cliente'
    return 'interna'


def build(values: list[list[str]]) -> dict:
    today = datetime.now(timezone(timedelta(hours=-5))).date()
    groups: list[dict] = []
    last_key = None
    for offset, raw in enumerate(values[FIRST_DATA_ROW - 1:]):
        row = (list(raw) + [''] * 30)[:30]
        if not any(c.strip() for c in row[2:29]) or not (row[2].strip() or row[4].strip() or row[5].strip()):
            continue
        dates = [parse_date(row[i]) for i in (1, 18, 21, 23, 25, 27, 28)]
        when = next((d for d in dates if d), None)
        key = (_plain(row[2]), _plain(row[4]), when)
        if key != last_key or not groups:
            groups.append({'rows': [], 'fecha': when, 'row': FIRST_DATA_ROW + offset})
            last_key = key
        groups[-1]['rows'].append(row)
    cases = []
    for g in groups:
        rows = g['rows']
        first = rows[0]
        steps = {}
        for key, label, col, resp_col in STEPS:
            done = [r for r in rows if _done(r[col])]
            stamps = [d for d in (parse_date(r[col]) for r in done) if d]
            people = sorted({r[resp_col].strip() for r in done if resp_col and r[resp_col].strip()})
            steps[key] = {'label': label, 'done': len(done), 'total': len(rows), 'fecha': max(stamps).isoformat() if stamps else '',
                          'resp': ', '.join(people)}
        finished = steps['terminacion']['done'] == len(rows)
        started = any(s['done'] for s in steps.values())
        age = (today - g['fecha']).days if g['fecha'] else 0
        state = 'terminada' if finished else ('historico' if age > OLD_AFTER_DAYS else ('en_proceso' if started else 'sin_iniciar'))
        reasons = [r[12].strip() for r in rows if r[12].strip()]
        notes = sorted({r[29].strip() for r in rows if r[29].strip()})
        cases.append({
            'id': g['row'], 'fecha': g['fecha'].isoformat() if g['fecha'] else '',
            'cliente': first[2].strip(), 'proyecto': first[3].strip(), 'cot': first[4].strip(),
            'prioridad': any(_plain(r[0]) == 'SI' for r in rows),
            'comercial': ', '.join(sorted({r[13].strip() for r in rows if r[13].strip()})),
            'tipo': next((t for t in ('garantia', 'cliente') if any(_tipo(x) == t for x in reasons)), 'interna'),
            'motivo': reasons[0] if reasons else '', 'estado': state, 'notas': notes, 'steps': steps,
            'unidades': sum(_int(r[6]) or 1 for r in rows),
            'piezas': [{'ref': r[5].strip(), 'cant': _int(r[6]) or 1, 'talla': r[7].strip(), 'numero': r[8].strip(), 'dorsal': r[9].strip(),
                        'genero': r[10].strip().upper(), 'pieza': r[11].strip(), 'motivo': r[12].strip(), 'tela': r[22].strip() if '❌' not in r[22] else '',
                        'maquina': r[19].strip(), 'hecha': _done(r[28])} for r in rows],
        })
    cases.sort(key=lambda c: (c['fecha'] or '0000', c['id']), reverse=True)
    return {'casos': cases, 'total_filas': sum(len(g['rows']) for g in groups)}


def _fetch() -> dict:
    spreadsheet = _provider().spreadsheet
    sheet = next((w for w in spreadsheet.worksheets() if w.id == SHEET_ID), None) or \
        next((w for w in spreadsheet.worksheets() if SHEET_TITLE_HINT in _plain(w.title)), None)
    if sheet is None:
        raise RuntimeError('No se encontró la pestaña REPOSICIONES-GARANTIAS')
    data = build(sheet.get(RANGE))
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    return data


def _save(data: dict) -> None:
    try:
        _snapshot_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _snapshot_file.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        tmp.replace(_snapshot_file)
    except OSError:
        logging.exception('No se pudo guardar la copia de reposiciones')


def _load_snapshot() -> dict | None:
    try:
        return json.loads(_snapshot_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def payload(force: bool = False) -> dict:
    with _lock:
        if _cache['data'] and not force and time.monotonic() - _cache['at'] < CACHE_SECONDS:
            return _cache['data']
        try:
            data = _fetch()
            if not data['casos'] and (_cache['data'] or _load_snapshot()):
                raise RuntimeError('La lectura llegó vacía; se conserva la copia anterior')
            _save(data)
        except Exception as exc:
            logging.exception('No se pudo leer REPOSICIONES-GARANTIAS')
            data = _cache['data'] or _load_snapshot() or {'casos': [], 'total_filas': 0, 'updated_at': ''}
            data = {**data, 'error': str(exc)[:160]}
        _cache.update({'at': time.monotonic(), 'data': data})
        return data


@router.get('')
def reposiciones(refresh: bool = False, dias: int = 120):
    """`dias`: solo casos de los últimos N días (0 = todo el historial)."""
    data = payload(force=refresh)
    casos = data.get('casos', [])
    if dias > 0:
        limite = (datetime.now(timezone(timedelta(hours=-5))).date() - timedelta(days=dias)).isoformat()
        casos = [c for c in casos if c['fecha'] >= limite]
    return {**data, 'casos': casos, 'total_casos': len(data.get('casos', [])), 'dias': dias}
