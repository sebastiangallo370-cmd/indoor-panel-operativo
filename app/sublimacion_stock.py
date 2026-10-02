"""Plan de rollos para Sublimación y descuento de inventario al finalizar.

El inventario se lee del Google Sheet (solo lectura). Los consumos se guardan en un
registro local y se aplican sobre la copia leída. Si el Sheet ya refleja el consumo
(el rollo original deja de existir), ese consumo se ignora.
"""
from __future__ import annotations

import copy
import json
import os
import re
import sqlite3
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

LEDGER_FILE = os.getenv('INVENTORY_SUBLIMACION_FILE', '/data/inventory_sublimacion.json')
DB_FILE = Path(os.getenv('STATE_DIR', '/data/state')) / 'jobs.sqlite3'
EXCLUDED_NAMES = ('DON ALVEIRO',)
COLORS = 5
# Al FINALIZAR Sublimación se descuentan del stock los MTS requeridos de esa referencia. Solo cuentan los consumos
# registrados desde 'aplicar_desde' (fecha guardada en el registro); los anteriores quedan como historial.
APPLY_CONSUMPTIONS = os.getenv('INVENTORY_APPLY_CONSUMPTIONS', '1') == '1'
_lock = threading.RLock()


def norm(value) -> str:
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(char for char in text if unicodedata.category(char) != 'Mn')
    return re.sub(r'\s+', ' ', text.upper()).strip()


def _label(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f'{value:,.2f}'.replace(',', ' ')


def _load_ledger() -> dict:
    try:
        with open(LEDGER_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            data.setdefault('plans', {})
            data.setdefault('done', {})
            return data
    except (OSError, ValueError):
        pass
    return {'plans': {}, 'done': {}}


def _save_ledger(ledger: dict) -> None:
    os.makedirs(os.path.dirname(LEDGER_FILE) or '.', exist_ok=True)
    tmp = LEDGER_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(ledger, handle, ensure_ascii=False)
    os.replace(tmp, LEDGER_FILE)


_MONTHS = {'ENE': 1, 'FEB': 2, 'MAR': 3, 'ABR': 4, 'MAY': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8,
           'SEP': 9, 'SEPT': 9, 'OCT': 10, 'NOV': 11, 'DIC': 12}


def parse_date(value) -> str:
    """'1-oct-26' o '26/09/2026' -> '2026-10-01'. Vacío si no se reconoce."""
    text = norm(value)
    match = re.match(r'^(\d{1,2})[-/ ]([A-Z]+)\.?[-/ ](\d{2,4})$', text)
    if match and match.group(2) in _MONTHS:
        day, month, year = int(match.group(1)), _MONTHS[match.group(2)], int(match.group(3))
    else:
        match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', text)
        if not match:
            return ''
        day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    year += 2000 if year < 100 else 0
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return ''


def read_orders() -> dict[int, dict] | None:
    """Órdenes con su estado de Sublimación: P (iniciada), DONE, NA o ''. None si no se pudo leer."""
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        raw_headers = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not raw_headers:
            return None
        headers = [norm(h) for h in json.loads(raw_headers[0])]
        if 'SUBLIMACION' not in headers or 'TELA' not in headers:
            return None
        si, ti = headers.index('SUBLIMACION'), headers.index('TELA')
        ei = headers.index('EDICION') if 'EDICION' in headers else None
        web = {r: n for r, n in db.execute('SELECT source_row,note FROM production_notes WHERE column_number=17')}
        try:
            sheet = {r: n for r, n in db.execute('SELECT source_row,note FROM production_sheet_notes WHERE column_number=17')}
        except sqlite3.Error:
            sheet = {}
        orders: dict[int, dict] = {}
        for row, raw in db.execute('SELECT source_row,values_json FROM production_rows'):
            values = json.loads(raw)
            if len(values) <= max(si, ti, 4):
                continue
            status = norm(values[si])
            if status == 'P':
                state = 'P'
            elif status == 'N/A':
                state = 'NA'
            elif status not in ('', 'R') and re.search(r'\d', status):
                state = 'DONE'
            else:
                state = ''
            edition = norm(values[ei]) if ei is not None and ei < len(values) else ''
            note = web.get(row) or sheet.get(row) or ''
            found = re.findall(r'(\d+(?:[.,]\d+)?)\s*MTS', note, re.I)
            orders[row] = {
                'orden': str(values[4]).strip(),
                'referencia': str(values[6]).strip() if len(values) > 6 else '',
                'tela': norm(values[ti]),
                'mts': float(found[-1].replace(',', '.')) if found else 0.0,
                'state': state,
                'edicion': 'DONE' if edition not in ('', 'R', 'N/A') and re.search(r'\d', edition) else '',
                'fecha': parse_date(values[ei]) if ei is not None and ei < len(values) else '',
            }
        return orders
    except (sqlite3.Error, ValueError, KeyError):
        return None
    finally:
        db.close()


def apply_consumptions(items: list[dict], done: dict, since: str = '') -> None:
    """Descuenta los consumos registrados desde 'since'; el sobrante del rollo queda como empezado."""
    for key in sorted(done, key=lambda k: done[k].get('ts', '')):
        if since and done[key].get('ts', '') < since:
            continue
        orden = done[key].get('orden', '')
        stamp = done[key].get('ts', '')
        for roll in done[key].get('rolls', []):
            item = next((i for i in items if i.get('nombre') == roll['item']), None)
            if not item:
                continue
            values = item.get('roll_values') or []
            statuses = item.setdefault('roll_statuses', ['new'] * len(values))
            index = next((i for i, v in enumerate(values) if abs(float(v) - roll['value']) < 1e-6), None)
            if index is None:
                # El Sheet ya refleja el descuento: si el rollo que sobró está ahí, debe figurar como EMPEZADO.
                left = round(roll['value'] - roll['take'], 2)
                if left > 0.009:
                    match = next((i for i, v in enumerate(values) if abs(float(v) - left) < 0.011), None)
                    if match is not None:
                        statuses[match] = 'started'
                        item.setdefault('sobrantes', []).append({'orden': orden, 'valor': left, 'ts': stamp})
                continue
            left = round(roll['value'] - roll['take'], 2)
            if left > 0.009:
                values[index] = left
                statuses[index] = 'started'
                item.setdefault('sobrantes', []).append({'orden': orden, 'valor': left, 'ts': stamp})
            else:
                values.pop(index)
                statuses.pop(index)
                if index < len(item.get('roll_bodegas') or []):
                    item['roll_bodegas'].pop(index)
            item['total'] = max(0.0, float(item.get('total') or 0) - roll['take'])
            item['mts'] = max(0.0, float(item.get('mts') or 0) - roll['take'])
            item['total_label'] = _label(item['total'])
            item['rolls'] = len(values)


def _base(item: dict) -> str:
    return ' ' + re.sub(r'^\(\d+\)\s*', '', norm(item['nombre'])) + ' '


def _matched(items: list[dict], tela: str) -> list[dict]:
    matched = [i for i in items if i.get('categoria') == 'BODEGA TELA' and f' {tela} ' in _base(i)
               and not any(name in _base(i) for name in EXCLUDED_NAMES) and ' RIB ' not in _base(i)]
    white = [i for i in matched if ' BLANCO ' in _base(i)]
    return white or matched


def _plan_label(order: dict, need: float) -> str:
    return order['orden'] + (f" · {order['referencia']}" if order.get('referencia') else '') + (f" · {f'{need:.2f}'.rstrip('0').rstrip('.').replace('.', ',')} MTS" if need else '')


def build_plan(items: list[dict], orders: list[tuple[int, dict]]) -> list[dict]:
    """Un plan por (orden, tela): varias referencias de la misma orden sobre la misma tela se tratan como UNA
    (mismo color, un solo total y rollos asignados para cubrir la suma)."""
    used: set[tuple[str, int]] = set()
    groups: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    for source_row, order in orders:
        if not order['tela']:
            continue
        groups.setdefault((order['orden'], order['tela']), []).append((source_row, order))
    plans = []
    for seq, ((orden, tela), members) in enumerate(groups.items()):
        members.sort(key=lambda pair: pair[0])
        need = round(sum(order['mts'] for _, order in members), 2)
        matched = _matched(items, tela)
        rolls = []
        for item in matched:
            for index, value in enumerate(item.get('roll_values') or []):
                if (item['id'], index) not in used:
                    rolls.append({'id': item['id'], 'item': item['nombre'], 'index': index, 'value': float(value),
                                  'started': (item.get('roll_statuses') or [])[index:index + 1] == ['started']})
        rolls.sort(key=lambda r: (not r['started'], r['value']))
        chosen, covered = [], 0.0
        if need > 0:
            for roll in rolls:
                if covered >= need:
                    break
                chosen.append(roll)
                covered += roll['value']
        elif rolls:
            chosen.append(rolls[0])
            covered = rolls[0]['value']
        short = need > 0 and covered < need
        for roll in chosen:
            used.add((roll['id'], roll['index']))
        owners = sorted({r['id'] for r in chosen}) or [i['id'] for i in matched]
        refs = [order.get('referencia') for _, order in members if order.get('referencia')]
        label = orden + (f" · {' + '.join(refs)}" if refs else '') + (f" · {f'{need:.2f}'.rstrip('0').rstrip('.').replace('.', ',')} MTS" if need else '')
        first = members[0][1]
        plans.append({
            'source_row': members[0][0], 'rows': [row for row, _ in members], 'row_mts': {str(row): order['mts'] for row, order in members},
            'orden': orden, 'tela': tela, 'fecha': first.get('fecha', ''), 'mts': need, 'color': seq % COLORS,
            'short': short, 'missing': round(need - covered, 2) if short else 0.0,
            'label': label, 'rolls': chosen, 'owners': owners,
        })
    return plans


def whole_mts(value: float) -> int:
    """Descuento en metros ENTEROS: se redondea al entero más cercano (mínimo 1 si se requiere algo)."""
    value = float(value or 0)
    return 0 if value <= 0 else max(1, int(value + 0.5))


def _consume(plan: dict, need: float | None = None) -> list[dict]:
    """Descuenta los MTS requeridos (suma del grupo) en números enteros. Un rollo se gasta completo si cabe;
    si no, se gasta una parte entera y el sobrante queda como rollo empezado."""
    left, taken = float(whole_mts(plan['mts'] if need is None else need)), []
    for roll in plan['rolls']:
        if left <= 0:
            break
        value = float(roll['value'])
        take = value if value <= left else float(max(1, int(left + 0.5)))
        take = min(take, value)
        taken.append({'item': roll['item'], 'value': roll['value'], 'take': round(take, 2)})
        left -= take
    return taken


def reconcile(base_items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Devuelve (inventario ajustado, plan de rollos de las órdenes en Sublimación P)."""
    with _lock:
        ledger = _load_ledger()
        orders = read_orders()
        changed = False
        if not ledger.get('aplicar_desde'):
            ledger['aplicar_desde'] = datetime.now(timezone.utc).isoformat()
            changed = True
        pending_rows: set[int] = set()
        if orders is not None:
            # Si a una referencia finalizada le quitan el estado (o vuelve a P/R), su consumo se deshace.
            for key in list(ledger['done']):
                rows = ledger['done'][key].get('rows') or [int(key)]
                states = [orders[r]['state'] for r in rows if r in orders]
                if states and any(state != 'DONE' for state in states):
                    ledger['done'].pop(key)
                    changed = True
            for key in list(ledger['plans']):
                plan = ledger['plans'][key]
                rows = plan.get('rows') or [int(key)]
                states = {r: (orders[r]['state'] if r in orders else None) for r in rows}
                if any(state == 'P' for state in states.values()):
                    # Sigue en curso: las referencias ya finalizadas esperan a que termine el resto del grupo.
                    pending_rows.update(r for r, state in states.items() if state in ('P', 'DONE'))
                    continue
                ledger['plans'].pop(key)
                changed = True
                done_rows = [r for r, state in states.items() if state == 'DONE']
                if done_rows and key not in ledger['done']:
                    need = round(sum((plan.get('row_mts') or {}).get(str(r), plan['mts'] if len(rows) == 1 else 0) for r in done_rows), 2)
                    taken = _consume(plan, need)
                    if taken:
                        ledger['done'][key] = {'orden': plan['orden'], 'ts': datetime.now(timezone.utc).isoformat(), 'rolls': taken, 'rows': done_rows}
        items = copy.deepcopy(base_items)
        if APPLY_CONSUMPTIONS:
            apply_consumptions(items, ledger['done'], ledger.get('aplicar_desde', ''))
        plans: list[dict] = []
        if orders is not None:
            consumed_rows = {r for key, entry in ledger['done'].items() for r in (entry.get('rows') or [int(key)])}
            active = sorted((r, o) for r, o in orders.items() if (o['state'] == 'P' or r in pending_rows) and r not in consumed_rows)
            plans = build_plan(items, active)
            current = {str(p['source_row']): p for p in plans}
            if current != ledger['plans']:
                ledger['plans'] = current
                changed = True
        if changed:
            _save_ledger(ledger)
        return items, plans


def forecast(items: list[dict]) -> list[dict]:
    """Órdenes con EDICIÓN finalizada que aún no entran a Sublimación: revisa por metros si la
    tela alcanza después de lo que consumirán las órdenes en Sublimación (P). Solo lectura."""
    with _lock:
        ledger = _load_ledger()
        orders = read_orders()
    if orders is None:
        return []
    active = sorted((r, o) for r, o in orders.items() if o['state'] == 'P' and str(r) not in ledger['done'])
    ready = sorted((r, o) for r, o in orders.items() if o['state'] == '' and o.get('edicion') == 'DONE')
    left = {i['id']: sum(float(v) for v in i.get('roll_values') or []) for i in items if i.get('categoria') == 'BODEGA TELA'}
    ids = {i['nombre']: i['id'] for i in items if i.get('categoria') == 'BODEGA TELA'}
    for plan in build_plan(items, active):
        for taken in _consume(plan):
            if taken['item'] in ids:
                left[ids[taken['item']]] -= taken['take']
    result = []
    for source_row, order in ready:
        if not order['tela']:
            continue
        matched = _matched(items, order['tela'])
        need = order['mts']
        have = sum(max(0.0, left[i['id']]) for i in matched)
        pending = need
        for item in matched:
            take = min(max(0.0, left[item['id']]), pending)
            left[item['id']] -= take
            pending -= take
        short = need > 0 and have < need
        result.append({
            'source_row': source_row, 'orden': order['orden'], 'tela': order['tela'], 'fecha': order.get('fecha', ''), 'mts': need,
            'short': short, 'missing': round(need - have, 2) if short else 0.0, 'disponible': round(have, 2),
            'label': _plan_label(order, need), 'rolls': [], 'owners': [i['id'] for i in matched],
            'telas': [i['nombre'] for i in matched],
        })
    return result


def start_worker(load_snapshot) -> None:
    """Revisa cada 30 s para registrar el consumo aunque nadie tenga abierta la página."""
    def worker():
        while True:
            try:
                snapshot = load_snapshot()
                if snapshot and snapshot.get('items') is not None:
                    reconcile(snapshot['items'])
            except Exception:
                pass
            threading.Event().wait(30)
    threading.Thread(target=worker, name='sublimacion-stock', daemon=True).start()
