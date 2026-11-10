import json
import re
import sqlite3
import tempfile
import unittest
import shutil
from pathlib import Path

from app import dinoman


class _Worksheet:
    def __init__(self):
        self.rows = {905: ['', '', '', '', 'CO100', '', 'REF01'] + [''] * 40}
        self.writes = []
        self.formats = []
        self.id = 1
        self.spreadsheet = self

    def row_values(self, number):
        return self.rows[number]

    def batch_update(self, values, **kwargs):
        if 'requests' in values:
            self.formats.append(values)
        else:
            self.writes.append((values, kwargs))


class DinomanTests(unittest.TestCase):
    def setUp(self):
        scratch = Path.cwd() / 'tmp'
        scratch.mkdir(exist_ok=True)
        self.root = Path(tempfile.mkdtemp(dir=scratch))
        self.db_path = self.root / 'jobs.sqlite3'
        self.state = self.root / 'dinoman.json'
        self.ws = _Worksheet()
        with sqlite3.connect(self.db_path) as db:
            db.row_factory = sqlite3.Row
            db.execute('CREATE TABLE production_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            db.execute('CREATE TABLE production_rows (source_row INTEGER PRIMARY KEY, values_json TEXT NOT NULL)')
            db.execute('CREATE TABLE production_sheet_links (source_row INTEGER PRIMARY KEY, sheet_row INTEGER NOT NULL)')
            headers = ['A', 'B', 'C', 'D', 'ORDEN', 'NOMBRE DEL CLIENTE', 'REFERENCIA', 'NOMBRE PROYECTO', 'DISENO', 'HORA INICIO', 'HORA FINAL', 'RESP.']
            groups = ['', '', '', '', '', '', '', '', 'DISEÑO', 'DISEÑO', 'DISEÑO', 'DISEÑO']
            db.executemany('INSERT INTO production_meta VALUES (?,?)', [('headers', json.dumps(headers)), ('groups', json.dumps(groups))])
            db.execute('INSERT INTO production_rows VALUES (?,?)', (1, json.dumps(['', '', '', '', 'CO100', 'Cliente Uno', 'REF01', 'Proyecto A', '', '', '', ''])))
            db.execute('INSERT INTO production_sheet_links VALUES (?,?)', (1, 905))
        def connect():
            db = sqlite3.connect(self.db_path)
            db.row_factory = sqlite3.Row
            return db
        dinoman.configurar(connect, lambda: self.ws, lambda: str(self.root / 'CLIENTES'), self.state)

    def tearDown(self):
        try:
            shutil.rmtree(self.root)
        except PermissionError:  # El sandbox de Windows puede retener SQLite hasta salir del intérprete.
            pass

    def test_only_marks_new_order_when_master_project_exists(self):
        project = self.root / 'CLIENTES' / 'Cliente Uno' / 'MAESTROS' / 'Proyecto A'
        project.mkdir(parents=True)
        dinoman.revisar()  # línea base: no toca históricos
        with sqlite3.connect(self.db_path) as db:
            db.execute('UPDATE production_rows SET values_json=? WHERE source_row=1',
                       (json.dumps(['', '', '', '', 'CO101', 'Cliente Uno', 'REF01', 'Proyecto A', '', '', '', '']),))
        self.ws.rows[905][4] = 'CO101'
        dinoman.revisar()
        self.assertEqual(len(self.ws.writes), 1)
        self.assertEqual([cell['values'][0][0] for cell in self.ws.writes[0][0]], ['', '', '', 'N/A'])
        color = self.ws.formats[0]['requests'][0]['repeatCell']['cell']['userEnteredFormat']['backgroundColor']
        self.assertEqual(color, {'red': 0, 'green': 1, 'blue': 0})

    def test_missing_project_never_writes(self):
        dinoman.revisar()
        with sqlite3.connect(self.db_path) as db:
            db.execute('UPDATE production_rows SET values_json=? WHERE source_row=1',
                       (json.dumps(['', '', '', '', 'CO101', 'Cliente Uno', 'REF01', 'Sin carpeta', '', '', '', '']),))
        self.ws.rows[905][4] = 'CO101'
        dinoman.revisar()
        self.assertEqual(self.ws.writes, [])


if __name__ == '__main__':
    unittest.main()
