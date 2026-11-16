"""ELIMINAR una orden con la carpeta ya borrada o a medias: elimina lo que falta. Con la NAS desconectada NO borra nada."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

T = Path(tempfile.mkdtemp())
NAS = T / 'CLIENTES'
(NAS / 'CLUB X').mkdir(parents=True)
for k, v in dict(NAS_CLIENTES_PATH=str(NAS), SUPABASE_URL='http://x', SUPABASE_KEY='x', GOOGLE_SHEETS_URL='http://x', GOOGLE_CREDENTIALS='{}',
                 PAGOS_COTIZACIONES_FILE_ID='x', PAGOS_COTIZACIONES_HOJA='x', SMTP_EMAIL='x', SMTP_PASSWORD='x', APP_USER='PRODUCCION', APP_PASSWORD='p').items():
    os.environ[k] = v
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

CARP = NAS / 'CLUB X' / 'CO7001_PROYECTO'


class BorradoParcial(unittest.TestCase):
    def setUp(self):
        db = main.connect()
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('headers', ?)", (json.dumps(['#', 'ORIGEN', 'NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO', 'ORDEN', 'REFERENCIA', 'CANTIDAD']),))
        db.execute('DELETE FROM production_rows WHERE source_row=9001')
        db.execute('INSERT INTO production_rows(source_row, values_json) VALUES (?,?)', (9001, json.dumps(['', 'BOT', 'CLUB X', 'P', 'CO7001', 'A100FUT01', '3'])))
        db.commit(); db.close()
        if CARP.exists():
            shutil.rmtree(CARP)
        CARP.mkdir(parents=True); (CARP / 'a.pdf').write_bytes(b'x'); (CARP / 'SUB').mkdir(); (CARP / 'SUB' / 'b.txt').write_text('x')
        main.verify_delete_password = lambda db, u, p: None
        main._orden_programada_en_panel = lambda o: True
        main.app.dependency_overrides[main.authenticate] = lambda: 'PRODUCCION'
        self.c = TestClient(main.app)

    def filas(self):
        db = main.connect(); n = db.execute('SELECT count(*) FROM production_rows WHERE source_row=9001').fetchone()[0]; db.close(); return n

    def borrar(self):
        return self.c.request('DELETE', '/api/produccion/orden/CO7001', json={'password': 'x'})

    def test_normal(self):
        self.assertEqual(self.borrar().status_code, 200)
        self.assertEqual((self.filas(), CARP.exists()), (0, False))

    def test_la_carpeta_ya_no_existe_elimina_lo_que_falta(self):
        shutil.rmtree(CARP)
        r = self.borrar()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.filas(), 0)

    def test_borrado_a_medias_se_completa(self):
        (CARP / 'a.pdf').unlink(); shutil.rmtree(CARP / 'SUB')
        self.assertEqual(self.borrar().status_code, 200)
        self.assertEqual((self.filas(), CARP.exists()), (0, False))

    def test_nas_desconectada_no_borra_nada(self):
        shutil.move(str(NAS / 'CLUB X'), str(T / 'guardada'))
        try:
            self.assertEqual(self.borrar().status_code, 503)
            self.assertEqual(self.filas(), 1)
        finally:
            shutil.move(str(T / 'guardada'), str(NAS / 'CLUB X'))

    def test_sin_tarjetas_no_falla(self):
        db = main.connect(); db.execute('DELETE FROM production_rows WHERE source_row=9001'); db.commit(); db.close()
        r = self.borrar()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get('sin_tarjetas'))


if __name__ == '__main__':
    unittest.main()
