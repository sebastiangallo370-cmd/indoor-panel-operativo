"""Varias órdenes de la misma tela: se sirven en orden de entrega y cada una sabe con cuáles comparte."""
import os
import sys
import tempfile
import unittest
from unittest import mock

os.environ.setdefault('PROVEEDORES_TELA_FILE', os.path.join(tempfile.mkdtemp(), 'proveedores_tela.json'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app import tela_necesaria as tn  # noqa: E402


def pedido(orden):
    return {'fila': 1, 'orden': orden, 'cliente': 'X', 'proyecto': '', 'referencia': 'A11200FUT01', 'tela': 'QATAR', 'cantidad': 1, 'estado': 'P', 'entrega': '2026-10-31'}


class TelaCompartida(unittest.TestCase):
    def test_cada_orden_descuenta_de_lo_que_queda_y_se_marca_compartida(self):
        items = [{'categoria': 'BODEGA TELA', 'nombre': '(11200) QATAR', 'roll_values': [497.0]}]
        consumos = iter([(147.38, ['FUT01'], []), (23.58, ['FUT01'], [])])
        with mock.patch.object(tn, '_pedidos', return_value=[pedido('CO6214'), pedido('CO6216')]), \
             mock.patch.object(tn, 'brecha_sublimacion', return_value=5), \
             mock.patch.object(tn.promedios, '_leer', return_value={'maestros': []}), \
             mock.patch.object(tn, '_consumo', side_effect=lambda *a: next(consumos)), \
             mock.patch.object(tn, '_exacto', return_value=None), \
             mock.patch.object(tn, '_telas_de_bodega', return_value=items):
            ords = {o['orden']: o for o in tn.calcular(items)['ordenes']}
        self.assertEqual(ords['CO6214']['disponible'], 497.0)
        self.assertEqual(ords['CO6214']['quedan'], 349.62)
        self.assertEqual(ords['CO6216']['disponible'], 349.62)   # lo que le queda a ESTA orden, no los 497
        self.assertEqual(ords['CO6216']['quedan'], 326.04)
        self.assertEqual(ords['CO6214']['compartida_con'], ['CO6216'])
        self.assertEqual(ords['CO6216']['compartida_con'], ['CO6214'])


if __name__ == '__main__':
    unittest.main()
