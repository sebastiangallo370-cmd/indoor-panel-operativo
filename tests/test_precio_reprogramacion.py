"""REPROGRAMACIÓN: el precio de la última venta del mismo cliente y referencia (desde cartera)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import pedido_effi  # noqa: E402

DOCS = {'documentos': [
    {'numero': '5968', 'cliente': 'JUAN CAMILO MUÑOZ PALACIO', 'fechaCreacion': '2026-09-04', 'estado': 'pedido',
     'items': [{'ref': 'A11400-100', 'precio': 89000}, {'ref': 'FUT04', 'precio': 27000}]},
    {'numero': '6100', 'cliente': 'JUAN CAMILO MUÑOZ PALACIO', 'fechaCreacion': '2026-10-01', 'estado': 'pedido',
     'items': [{'ref': 'A200FUT04', 'precio': 31000}]},
    {'numero': '6200', 'cliente': 'JUAN CAMILO MUÑOZ PALACIO', 'fechaCreacion': '2026-11-01', 'estado': 'anulada',
     'items': [{'ref': 'A200FUT04', 'precio': 99000}]},
    {'numero': '7000', 'cliente': 'OTRO CLIENTE', 'fechaCreacion': '2026-11-05', 'estado': 'pedido',
     'items': [{'ref': 'A200FUT04', 'precio': 50000}]},
]}


class PrecioReprogramacionTest(unittest.TestCase):
    def _buscar(self, cliente, ref):
        from app import cartera_api
        with mock.patch.object(cartera_api, '_load', return_value=DOCS):
            return pedido_effi.precio_ultima_venta(cliente, ref)

    def test_toma_la_ultima_venta_no_anulada(self):
        r = self._buscar('Juan Camilo Muñoz Palacio', 'A200FUT04')
        self.assertTrue(r['encontrado'])
        self.assertEqual(r['precio'], 31000)
        self.assertEqual(r['numero'], '6100')

    def test_coincide_por_sufijo_de_referencia(self):
        r = self._buscar('JUAN CAMILO MUÑOZ PALACIO', 'FUT04')
        self.assertEqual(r['precio'], 31000)

    def test_no_mezcla_clientes(self):
        r = self._buscar('OTRO CLIENTE', 'A200FUT04')
        self.assertEqual(r['precio'], 50000)

    def test_sin_historial(self):
        self.assertFalse(self._buscar('JUAN CAMILO MUÑOZ PALACIO', 'A999ZZ01')['encontrado'])
        self.assertFalse(self._buscar('', 'A200FUT04')['encontrado'])


if __name__ == '__main__':
    unittest.main()
