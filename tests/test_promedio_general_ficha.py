"""Sin maestro talla por talla, el consumo usa el PROMEDIO GENERAL de la ficha (Masculino/Femenino/Niño)."""
import os
import tempfile
import unittest
from unittest import mock

os.environ.setdefault('PROVEEDORES_TELA_FILE', os.path.join(tempfile.mkdtemp(), 'proveedores_tela.json'))

from app import fichas, tela_necesaria  # noqa: E402

FICHA = {'id': 'f1', 'promedios': [{'nombre': 'PROMEDIO M1', 'valores': {'masc': '1.5', 'feme': '1,2', 'nino': '1.0'}}]}


class PromedioGeneral(unittest.TestCase):
    def test_promedio_general_de_los_tres_generos(self):
        with mock.patch.object(fichas, 'indice', return_value={'fichas': [{'id': 'f1', 'ref': 'FUT01'}]}), mock.patch.object(fichas, 'ficha', return_value=FICHA):
            self.assertEqual(fichas.promedio_general('FUT01'), 1.23)   # (1.5 + 1.2 + 1.0) / 3

    def test_sin_ficha_o_sin_numeros_da_cero(self):
        with mock.patch.object(fichas, 'indice', return_value={'fichas': []}):
            self.assertEqual(fichas.promedio_general('XX01'), 0.0)
        vacia = {'id': 'f2', 'promedios': [{'nombre': 'P', 'valores': {'masc': 'X', 'feme': ''}}]}
        with mock.patch.object(fichas, 'indice', return_value={'fichas': [{'id': 'f2', 'ref': 'XX01'}]}), mock.patch.object(fichas, 'ficha', return_value=vacia):
            self.assertEqual(fichas.promedio_general('XX01'), 0.0)


class ConsumoConFicha(unittest.TestCase):
    def setUp(self):
        tela_necesaria._general_cache.clear()

    def test_sin_maestro_usa_el_general_de_la_ficha(self):
        with mock.patch.object(tela_necesaria, '_general_de_ficha', return_value=1.23):
            total, usados, faltan = tela_necesaria._consumo('A100FUT01', {}, {})
        self.assertEqual((total, faltan), (1.23, []))
        self.assertIn('promedio general de la ficha', usados[0])

    def test_con_maestro_sigue_usando_el_maestro(self):
        maestro = {'ref': 'FUT01', 'masc': [1.0, 1.0], 'fem': [], 'nino': [], 'nina': []}
        with mock.patch.object(tela_necesaria, '_general_de_ficha', return_value=9.9):
            total, usados, faltan = tela_necesaria._consumo('A100FUT01', {'FUT01': maestro}, {})
        self.assertEqual((total, usados, faltan), (1.0, ['FUT01'], []))


if __name__ == '__main__':
    unittest.main()
