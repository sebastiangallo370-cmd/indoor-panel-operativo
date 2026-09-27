"""Read-only Sheets -> production delta sync. No source or NAS writes."""
import collections
import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone

SPREADSHEET_ID = '1n7t5F1ZTX4Fwj3_ZAS1hdHnF7g16kTXfmFFkNa7M3tg'
SHEET_ID = 1514880696
START_ROW = 706
WIDTH = 83


def identity(values):
    return json.dumps([str(values[i] or '').strip().upper() for i in (4, 6)], ensure_ascii=False)


def fetch(worksheet):
    if worksheet.spreadsheet.id != SPREADSHEET_ID or worksheet.id != SHEET_ID:
        raise ValueError('La conexión no corresponde a la hoja autorizada')
    meta = worksheet.spreadsheet.fetch_sheet_metadata()
    prop = next(s['properties'] for s in meta['sheets'] if s['properties']['sheetId'] == SHEET_ID)
    title = prop['title'].replace("'", "''")
    ranges = [f"'{title}'!A2:CE3"] + [
        f"'{title}'!A{s}:CE{min(s+249, prop['gridProperties']['rowCount'])}"
        for s in range(START_ROW, prop['gridProperties']['rowCount']+1, 250)]
    cells = {}
    for bounded_range in ranges:
        response = worksheet.spreadsheet.fetch_sheet_metadata(params={
            'ranges': bounded_range, 'includeGridData': 'true',
            'fields': 'sheets(data(startRow,startColumn,rowData(values(formattedValue,userEnteredValue,note,hyperlink))))'})
        for sheet in response.get('sheets', []):
            for block in sheet.get('data', []):
                for offset, row in enumerate(block.get('rowData', [])):
                    cells[block.get('startRow', 0)+offset+1] = row.get('values', [])
    headers = [c.get('formattedValue', '').strip() or f'COLUMNA {i+1}'
               for i, c in enumerate((cells.get(3, [])+[{}]*WIDTH)[:WIDTH])]
    rows = []
    for number, cell_row in sorted(cells.items()):
        if number < START_ROW:
            continue
        values = [c.get('formattedValue', '') for c in (cell_row+[{}]*WIDTH)[:WIDTH]]
        if not values[4].strip():
            continue  # Ignore formula-only template rows, not orders without reference.
        rows.append({'sheet_row': number, 'values': values,
                     'notes': {str(i+1): c['note'] for i, c in enumerate(cell_row) if c.get('note')},
                     'cells': cell_row})
    duplicates = [k for k, count in collections.Counter(identity(r['values']) for r in rows).items() if count > 1]
    if duplicates:
        raise ValueError('Órdenes/referencias repetidas; sincronización pausada para evitar una asociación incorrecta')
    return {'headers': headers, 'rows': rows, 'sheet': prop['title']}


def schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS production_sheet_links (
      identity TEXT PRIMARY KEY, source_row INTEGER UNIQUE NOT NULL,
      sheet_row INTEGER NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS production_sheet_notes (
      source_row INTEGER NOT NULL,column_number INTEGER NOT NULL,note TEXT NOT NULL,
      PRIMARY KEY(source_row,column_number));
    CREATE TABLE IF NOT EXISTS production_sheet_audit (
      id INTEGER PRIMARY KEY,source_row INTEGER,previous_values TEXT,
      new_values TEXT,created_at TEXT);
    ''')


def apply(db, snapshot):
    """Atomically merge, retaining local IDs, history, local notes and tombstones."""
    schema(db)
    db.execute('BEGIN IMMEDIATE')
    try:
        headers = json.loads(db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()[0])
        if headers != snapshot['headers']:
            raise ValueError('Las columnas de Google Sheets cambiaron; no se importó nada')
        local = {}
        for number, raw in db.execute('SELECT source_row,values_json FROM production_rows'):
            values = json.loads(raw)
            if len(values)>6 and str(values[4]).strip():
                k = identity(values)
                if k in local:
                    raise ValueError('Identidad duplicada en la web; requiere revisión')
                local[k] = (number, values)
        deleted = set()
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='production_deleted_rows'").fetchone():
            for (raw,) in db.execute('SELECT payload FROM production_deleted_rows'):
                deleted.add(identity(json.loads(json.loads(raw)['values_json'])))
        maximum = max(START_ROW, db.execute('SELECT COALESCE(MAX(source_row),0) FROM production_rows').fetchone()[0],
                      int((db.execute("SELECT value FROM production_meta WHERE key='last_allocated_row'").fetchone() or [0])[0]))
        now = datetime.now(timezone.utc).isoformat()
        counts = {'new': 0, 'updated': 0, 'linked': 0, 'skipped_deleted': 0, 'notes': 0}
        for item in snapshot['rows']:
            key = identity(item['values'])
            link = db.execute('SELECT source_row,snapshot FROM production_sheet_links WHERE identity=?', (key,)).fetchone()
            if key in deleted or (link and not db.execute('SELECT 1 FROM production_rows WHERE source_row=?',(link[0],)).fetchone()):
                counts['skipped_deleted'] += 1
                continue
            old = json.loads(link[1]) if link else None
            if key in local:
                number, before = local[key]
                if link and number != link[0]:
                    raise ValueError('La identidad local cambió; se conserva sin sobrescribir')
                after = list(before)
                after += [''] * (WIDTH-len(after))
                for i, value in enumerate(item['values']):
                    if old is None or value != old['values'][i]:
                        after[i] = value
                if before != after:
                    db.execute('INSERT INTO production_sheet_audit(source_row,previous_values,new_values,created_at) VALUES (?,?,?,?)',
                               (number,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),now))
                    db.execute('UPDATE production_rows SET values_json=? WHERE source_row=?', (json.dumps(after,ensure_ascii=False),number))
                    counts['updated'] += 1
            else:
                maximum += 1
                number = maximum
                db.execute('INSERT INTO production_rows(source_row,values_json,sort_order) VALUES (?,?,?)',
                           (number,json.dumps(item['values'],ensure_ascii=False),number))
                counts['new'] += 1
            db.execute('DELETE FROM production_sheet_notes WHERE source_row=?',(number,))
            db.executemany('INSERT INTO production_sheet_notes VALUES (?,?,?)',
                           [(number,int(column),note) for column,note in item['notes'].items()])
            db.execute('INSERT OR REPLACE INTO production_sheet_links VALUES (?,?,?,?)',
                       (key,number,item['sheet_row'],json.dumps(item,ensure_ascii=False)))
            counts['linked'] += 1
            counts['notes'] += len(item['notes'])
        db.executemany('INSERT OR REPLACE INTO production_meta(key,value) VALUES (?,?)',[
            ('last_allocated_row',str(maximum)),('sheets_sync_checked_at',now),
            ('sheets_sync_error',''),('sheets_sync_counts',json.dumps(counts)),('updated_at',now)])
        db.commit()
        return counts
    except Exception:
        db.rollback()
        raise


def decorate(db, data):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='production_sheet_links'").fetchone():
        return data
    linked = {str(r[0]) for r in db.execute('SELECT source_row FROM production_sheet_links')}
    # Old local fallback events must not turn an imported blank back into 'finished'.
    data['auto_closed'] = [k for k in data['auto_closed'] if k.split(':')[0] not in linked]
    data['process_responsibles'] = {k:v for k,v in data['process_responsibles'].items() if k.split(':')[0] not in linked}
    for row, column, note in db.execute('SELECT source_row,column_number,note FROM production_sheet_notes'):
        key = f'{row}:{column}'
        local = data['notes'].get(key, '')
        entries = data.setdefault('note_entries', {})
        if note != local:
            entries[key] = [{'text': note, 'author': ''}] + entries.get(key, [])
        data['notes'][key] = note if not local or local == note else note+'\n\nNota de la web: '+local
    meta = dict(db.execute("SELECT key,value FROM production_meta WHERE key LIKE 'sheets_sync_%'"))
    data['sheets_sync'] = {'checked_at':meta.get('sheets_sync_checked_at'), 'error':meta.get('sheets_sync_error',''), 'start_row':START_ROW}
    return data


def start(connect, worksheet_provider, state_dir):
    enabled = state_dir / 'sheets-sync-enabled'
    if not enabled.exists():
        return
    def worker():
        while enabled.exists():
            try:
                snapshot = fetch(worksheet_provider())
                with connect() as db:
                    backup = state_dir / 'before-sheets-sync.sqlite3'
                    if not backup.exists():
                        with sqlite3.connect(backup) as destination:
                            db.backup(destination)
                    counts = apply(db, snapshot)
                logging.info('Sheets sync: %s', counts)
            except Exception as error:
                logging.exception('Google Sheets sync failed; local production preserved')
                with connect() as db:
                    db.execute("INSERT OR REPLACE INTO production_meta VALUES ('sheets_sync_error',?)",(str(error)[:500],))
            threading.Event().wait(30)
    threading.Thread(target=worker, name='sheets-production-sync', daemon=True).start()
