"""Las referencias pendientes se registran como maestro con el promedio general de su ficha; las que ya tienen consumos no se tocan."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault('PROVEEDORES_TELA_FILE', os.path.join(tempfile.mkdtemp(), 'proveedores_tela.json'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app import promedios  # noqa: E402


class RegistrarGenerales(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / 'maestros.json'
        self.tmp.write_text(json.dumps({'maestros': [
            {'ref': 'CA00', 'diseno': 'D6', 'masc': ['1.0'] * 8, 'fem': ['1.0'] * 8, 'nino': ['1.0'] * 8, 'nina': ['1.0'] * 8}
        ], 'notas': []}), encoding='utf-8')
        self.patch = mock.patch.object(promedios, 'ARCHIVO', self.tmp)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_registra_las_pendientes_con_el_general_y_no_toca_las_que_ya_tienen_consumos(self):
        generales = {'FUT01': 1.23, 'CA00': 9.0, 'XX99': 0.0}
        with mock.patch('app.fichas.promedio_general', side_effect=lambda r: generales.get(r, 0.0)):
            r = promedios.registrar_generales({'refs': ['fut01', 'CA00', 'XX99']})
        self.assertEqual([c['ref'] for c in r['creados']], ['FUT01'])
        self.assertEqual(r['omitidos'], [{'ref': 'CA00', 'motivo': 'ya tiene consumos'}, {'ref': 'XX99', 'motivo': 'su ficha no tiene promedio'}])
        datos = json.loads(self.tmp.read_text(encoding='utf-8'))
        fut = next(m for m in datos['maestros'] if m['ref'] == 'FUT01')
        self.assertEqual(fut['masc'][0], 1.23)
        self.assertEqual(len(fut['masc']), 8)
        self.assertEqual(len(fut['nina']), 8)
        ca = next(m for m in datos['maestros'] if m['ref'] == 'CA00')
        self.assertEqual(float(ca['masc'][0]), 1.0)   # intacto


if __name__ == '__main__':
    unittest.main()
