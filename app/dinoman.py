"""DINOMAN: valida maestros en la NAS al programarse un pedido.

No tiene rutas ni interfaz. Se activa por la señal de pedido programado y, si
existe CLIENTE/MAESTROS/PROYECTO, deja en verde el bloque DISEÑO del Sheet.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import unicodedata
from pathlib import Path
from typing import Callable

_connect: Callable = lambda: None
_worksheet: Callable = lambda: None
_clientes_root: Callable = lambda: ''
_state_file = Path('/data/state/dinoman.json')
_lock = threading.Lock()
_running = False


def configurar(connect: Callable, worksheet: Callable, clientes_root: Callable, state_file: Path | None = None) -> None:
    global _connect, _worksheet, _clientes_root, _state_file
    _connect, _worksheet, _clientes_root = connect, worksheet, clientes_root
    if state_file is not None:
        _state_file = state_file


def _plain(value: object) -> str:
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]+', '', text.upper())


def _load() -> dict:
    try:
        data = json.loads(_state_file.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    _state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _state_file.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_state_file)


def _folder(parent: Path, name: str) -> Path | None:
    try:
        return next((p for p in parent.iterdir() if p.is_dir() and _plain(p.name) == _plain(name)), None)
    except OSError:
        return None


def _has_project(client: str, project: str) -> bool:
    root = Path(str(_clientes_root() or '')).resolve()
    if not client or not project or not root.is_dir():
        return False
    client_dir = _folder(root, client)
    if not client_dir:
        return False
    masters = _folder(client_dir, 'MAESTROS') or _folder(client_dir, 'MAESTRO')
    return bool(masters and _folder(masters, project))


def _columns(headers: list, groups: list) -> dict | None:
    h = [_plain(x) for x in headers]
    g = [_plain(x) for x in groups] + [''] * max(0, len(h) - len(groups))
    design = next((i for i, name in enumerate(h) if name == 'DISENO' and (g[i] == 'DISENO' or not g[i])), -1)
    if design < 0:
        return None
    same_group = lambda i: g[i] == g[design] or not g[i]
    start = next((i for i, name in enumerate(h) if same_group(i) and name == 'HORAINICIO'), -1)
    final = next((i for i, name in enumerate(h) if same_group(i) and name == 'HORAFINAL'), -1)
    responsible = next((i for i, name in enumerate(h) if same_group(i) and name.startswith('RESP')), -1)
    return {'design': design + 1, 'start': start + 1, 'final': final + 1, 'responsible': responsible + 1} if start >= 0 and final >= 0 and responsible >= 0 else None


def _a1(row: int, column: int) -> str:
    letters = ''
    while column:
        column, rest = divmod(column - 1, 26)
        letters = chr(65 + rest) + letters
    return f'{letters}{row}'


def _mark(sheet_row: int, order: str, reference: str, columns: dict) -> bool:
    ws = _worksheet()
    live = ws.row_values(sheet_row)
    # La fila puede haberse movido entre la sincronización y esta escritura.
    if len(live) < 7 or _plain(live[4]) != _plain(order) or _plain(live[6]) != _plain(reference):
        return False
    chosen = (columns['design'], columns['start'], columns['final'], columns['responsible'])
    values = {col: str(live[col - 1] if len(live) >= col else '').strip() for col in chosen}
    # No pisa lo que haya registrado una persona. RESP ya puede traer N/A de
    # la lista desplegable: en ese caso se completa el resto del bloque.
    if any(values[col] for col in chosen if col != columns['responsible']) or values[columns['responsible']].upper() not in ('', 'N/A'):
        return False
    # Las tres primeras celdas se dejan intencionalmente vacías: el verde
    # significa que el maestro existe y el equipo puede iniciar Diseño.
    ws.batch_update([
        {'range': _a1(sheet_row, columns['design']), 'values': [['']]},
        {'range': _a1(sheet_row, columns['start']), 'values': [['']]},
        {'range': _a1(sheet_row, columns['final']), 'values': [['']]},
        {'range': _a1(sheet_row, columns['responsible']), 'values': [['N/A']]},
    ], value_input_option='USER_ENTERED')
    green = {'red': 0, 'green': 1, 'blue': 0}
    ws.spreadsheet.batch_update({'requests': [{
        'repeatCell': {
            'range': {'sheetId': ws.id, 'startRowIndex': sheet_row - 1, 'endRowIndex': sheet_row,
                      'startColumnIndex': min(chosen) - 1, 'endColumnIndex': max(chosen)},
            'cell': {'userEnteredFormat': {'backgroundColor': green}},
            'fields': 'userEnteredFormat.backgroundColor',
        }
    }]})
    return True


def revisar() -> None:
    """Procesa únicamente filas que aparecieron después de la primera lectura.

    El primer recorrido crea la línea base para no iniciar DISEÑO en pedidos
    históricos al desplegar esta versión.
    """
    state = _load()
    db = _connect()
    try:
        meta = {r['key']: r['value'] for r in db.execute("SELECT key,value FROM production_meta")}
        headers, groups = json.loads(meta.get('headers') or '[]'), json.loads(meta.get('groups') or '[]')
        cols = _columns(headers, groups)
        names = {_plain(name): i for i, name in enumerate(headers)}
        needed = ('ORDEN', 'REFERENCIA', 'NOMBREDELCLIENTE', 'NOMBREPROYECTO')
        if not cols or any(name not in names for name in needed):
            return
        rows = db.execute('SELECT r.source_row,r.values_json,l.sheet_row FROM production_rows r '
                          'JOIN production_sheet_links l ON l.source_row=r.source_row').fetchall()
    finally:
        db.close()
    signatures = {}
    # Una orden puede ocupar varias filas (una por referencia). Se procesan
    # juntas y en orden, para que DINOMAN termine una orden antes de pasar a
    # la siguiente.
    rows = sorted(rows, key=lambda row: (lambda values: _plain(values[names['ORDEN']] if names['ORDEN'] < len(values) else ''))(json.loads(row['values_json'])))
    for row in rows:
        values = json.loads(row['values_json'])
        get = lambda name: str(values[names[name]] if names[name] < len(values) else '').strip()
        order, reference, client, project = (get(n) for n in needed)
        if order and reference:
            signatures[str(row['source_row'])] = '|'.join((_plain(order), _plain(reference), _plain(client), _plain(project)))
    if not state.get('initialized'):
        _save({'initialized': True, 'seen': signatures})
        logging.info('DINOMAN: línea base creada (%s filas); no se tocaron pedidos anteriores', len(signatures))
        return
    seen = state.get('seen') if isinstance(state.get('seen'), dict) else {}
    for row in rows:
        key = str(row['source_row'])
        if key not in signatures or seen.get(key) == signatures[key]:
            continue
        values = json.loads(row['values_json'])
        get = lambda name: str(values[names[name]] if names[name] < len(values) else '').strip()
        order, reference, client, project = (get(n) for n in needed)
        try:
            if _has_project(client, project) and _mark(int(row['sheet_row']), order, reference, cols):
                logging.info('DINOMAN: DISEÑO iniciado para %s / %s', order, reference)
        except Exception:
            logging.exception('DINOMAN: no se pudo revisar %s / %s', order, reference)
    _save({'initialized': True, 'seen': signatures})


def notificar(origen: str = '') -> None:
    """Lanza una única revisión silenciosa y no bloquea a quien programa."""
    global _running
    with _lock:
        if _running:
            return
        _running = True
    def run():
        global _running
        try:
            revisar()
        finally:
            with _lock:
                _running = False
    threading.Thread(target=run, name='dinoman-maestros', daemon=True).start()
