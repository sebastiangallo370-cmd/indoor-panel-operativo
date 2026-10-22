import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import stockman


class NombresTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True)]
        for m in self.p:
            m.start()

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def refrescar(self, telas, articulo):
        with mock.patch.object(stockman.proveedores_tela, 'telas', lambda: telas), mock.patch.object(stockman.effi_api, 'articulo', articulo):
            return stockman.refrescar_nombres()

    def test_el_alias_cubre_el_nombre_con_y_sin_codigo_y_los_espacios_dobles(self):
        r = self.refrescar([{'codigo': '4100', 'nombre': 'DUAL  BLANCO', 'id_effi': ''}], lambda ref, ide='': {'id': '2707', 'descripcion': 'DUAL'})
        self.assertEqual(r['cambiadas'], 1)
        m = stockman.mapa()
        self.assertEqual(m['DUAL BLANCO'], 'DUAL')
        self.assertEqual(m['(4100) DUAL BLANCO'], '(4100) DUAL')

    def test_una_tela_que_effi_no_ve_conserva_su_ultimo_nombre(self):
        self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], lambda ref, ide='': {'id': '9', 'descripcion': 'ARTICULO A'})

        def falla(ref, ide=''):
            raise stockman.effi_api.EffiError('no hay')
        r = self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], falla)
        self.assertEqual(r['sin_articulo'], ['1'])
        self.assertEqual(stockman.mapa()['A'], 'ARTICULO A')

    def test_inventario_vacio_no_toca_nada(self):
        self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], lambda ref, ide='': {'id': '9', 'descripcion': 'ARTICULO A'})
        self.assertFalse(self.refrescar([], lambda ref, ide='': {})['ok'])
        self.assertEqual(stockman.mapa()['A'], 'ARTICULO A')


if __name__ == '__main__':
    unittest.main()
