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


class AjusteTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True),
                  mock.patch.object(stockman.proveedores_tela, 'telas', lambda: [{'codigo': '100', 'nombre': 'MONTECATINI BLANCO', 'id_effi': '6082'}])]
        for m in self.p:
            m.start()
        d = stockman._leer()
        d['nombres']['100'] = {'nombre_panel': 'MONTECATINI BLANCO', 'nombre_effi': '903385 MONTECATINI DB BCO 1A', 'id_effi': '6082', 'stock_effi': {'5': 2981.0, '21': 0.41}}
        stockman._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_la_diferencia_por_bodega_deja_effi_igual_al_panel(self):
        with mock.patch.object(stockman, '_stock_panel', lambda: {'100': {'21': 2000.0, '23': 968.0}}):
            f = stockman.evaluar()[0]
        por = {b['bodega']: b['delta'] for b in f['bodegas']}
        self.assertEqual((por['21'], por['23'], por['5']), (1999.59, 968.0, -2981.0))   # Materia Prima (5) queda en cero y las bodegas del panel igualan
        self.assertEqual(f['estado'], 'ajustar')

    def test_tela_igual_no_se_ajusta(self):
        d = stockman._leer()
        d['nombres']['100']['stock_effi'] = {'21': 2000.0, '23': 968.0}
        stockman._guardar(d)
        with mock.patch.object(stockman, '_stock_panel', lambda: {'100': {'21': 2000.0, '23': 968.0}}):
            self.assertEqual(stockman.evaluar()[0]['estado'], 'igual')

    def test_aplicar_crea_un_ajuste_por_bodega_con_diferencia(self):
        hechos = []
        crear = lambda clave, bodega, art, delta, obs: hechos.append((bodega, art, delta)) or {'id': str(len(hechos)), 'total': None}
        with mock.patch.object(stockman, '_stock_panel', lambda: {'100': {'21': 2000.0}}), mock.patch.object(stockman.effi_api, 'crear_ajuste', crear),                 mock.patch.object(stockman.effi_api, 'articulo', lambda *a: {'stock_bodegas': [{'bodega': '21', 'stock': '2000'}]}):
            r = stockman.aplicar_tela('100', 'ADMIN')
        self.assertEqual(r['ajustes'], 2)
        self.assertIn((21, '6082', 1999.59), hechos)
        self.assertIn((5, '6082', -2981.0), hechos)
        self.assertEqual(stockman._leer()['nombres']['100']['stock_effi'], {'21': 2000.0})


if __name__ == '__main__':
    unittest.main()
