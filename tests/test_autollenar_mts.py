"""Los MTS calculados con el promedio se anotan en la tarjeta de Producción sin pisar lo que puso una persona ni lo del Sheet."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import tela_necesaria


class AutollenarMts(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.dir.name) / 'jobs.sqlite3'
        db = sqlite3.connect(self.db_path)
        db.executescript("""
            CREATE TABLE production_notes (source_row INTEGER NOT NULL, column_number INTEGER NOT NULL, note TEXT NOT NULL, username TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source_row, column_number));
            CREATE TABLE production_sheet_notes (source_row INTEGER NOT NULL, column_number INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY(source_row, column_number));
            CREATE TABLE production_meta (key TEXT PRIMARY KEY, value TEXT);
        """)
        db.execute("INSERT INTO production_notes VALUES (2, 17, '10.00 MTS', 'MARIA', 'x')")            # la puso una persona
        db.execute("INSERT INTO production_sheet_notes VALUES (3, 17, 'Mts: 55 MTS')")                   # ya está en el Sheet
        db.execute("INSERT INTO production_notes VALUES (4, 17, '5.00 MTS', 'AGENTE INVENTARIO', 'x')")  # la puso el agente antes
        db.commit()
        db.close()
        self.parche = mock.patch.object(tela_necesaria, 'DB_FILE', str(self.db_path))
        self.parche.start()

    def tearDown(self):
        self.parche.stop()
        self.dir.cleanup()

    def notas(self):
        db = sqlite3.connect(self.db_path)
        try:
            return {r[0]: (r[1], r[2]) for r in db.execute('SELECT source_row, note, username FROM production_notes WHERE column_number=17')}
        finally:
            db.close()

    def test_solo_llena_donde_nadie_escribio(self):
        ordenes = [{'fila': 1, 'mts': 12.345, 'situacion': 'alcanza'}, {'fila': 2, 'mts': 99, 'situacion': 'alcanza'},
                   {'fila': 3, 'mts': 99, 'situacion': 'alcanza'}, {'fila': 4, 'mts': 7.5, 'situacion': 'alcanza'},
                   {'fila': 5, 'mts': 0, 'situacion': 'sin_promedio'}, {'fila': 6, 'mts': 8, 'situacion': 'sin_promedio'},
                   {'fila': 7, 'mts': 20, 'situacion': 'alcanza', 'estado': 'P'}]
        r = tela_necesaria.autollenar_mts(ordenes)
        n = self.notas()
        self.assertEqual(r['escritas'], 2)
        self.assertEqual(n[1], ('12.35 MTS', 'AGENTE INVENTARIO'))   # fila libre: se llena
        self.assertEqual(n[2], ('10.00 MTS', 'MARIA'))              # persona: intacta
        self.assertNotIn(3, n)                                       # Sheet: no se escribe
        self.assertEqual(n[4], ('7.50 MTS', 'AGENTE INVENTARIO'))   # su propia nota se actualiza
        self.assertNotIn(5, n)
        self.assertNotIn(6, n)                                       # sin promedio: nada
        self.assertNotIn(7, n)                                       # ya en Sublimación (P): no se toca

    def test_no_repite(self):
        o = [{'fila': 1, 'mts': 3, 'situacion': 'alcanza'}]
        self.assertEqual(tela_necesaria.autollenar_mts(o)['escritas'], 1)
        self.assertEqual(tela_necesaria.autollenar_mts(o)['escritas'], 0)


if __name__ == '__main__':
    unittest.main()
