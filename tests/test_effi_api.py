"""Cálculo y armado del pedido de la API de Effi (sin llamar a Effi: las consultas se simulan)."""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'ecommerce_pc'))
import effi_api  # noqa: E402


def lista_falsa(ruta, params=None):
    if ruta == 'proveedor':
        return [{'tercero': '381', 'nombre': 'TEJIDOS DE PUNTO LINDATEXTIL S.A.S', 't_forma_pago': '4',
                 'direcciones': [{'id': '1', 'id_pais': '47', 'id_provincia': '776', 'id_ciudad': '12601', 'direccion': 'AUT MED-BTA KM 37', 'referencia': ''}]}]
    if ruta == 'articulo':
        return [{'id': '6081', 'referencia': '1000', 'descripcion': 'OTRO', 'p_costo_ultimo': '1', 'impuesto': None},
                {'id': '6082', 'referencia': '100', 'descripcion': '903385 MONTECATINI DB BCO 1A', 'p_costo_ultimo': '7930.0000', 'impuesto': 'IVA 19%'}]
    if ruta == 'impuesto':
        return [{'id': '16', 'nombre': 'IVA 19% compras', 'etiqueta': 'IVA 19%', 'tipo_calculo': 'Porcentaje', 'valor': '19.000'}]
    if ruta == 'retencion':
        return [{'id': '5', 'nombre': 'Retefuente 2.5%', 'etiqueta': 'Retefuente 2.5%', 'tipo_calculo': 'Porcentaje', 'valor': '2.500'}]
    return []


class PedidoEffi(unittest.TestCase):
    def setUp(self):
        self.p = [mock.patch.object(effi_api, '_lista', side_effect=lista_falsa), mock.patch.dict(os.environ, {'EFFI_API_KEY': 'x' * 40}, clear=False)]
        for m in self.p:
            m.start()

    def tearDown(self):
        for m in self.p:
            m.stop()

    def test_referencia_exacta_y_total_con_iva(self):
        with mock.patch.dict(os.environ, {'EFFI_DESCUENTO_PCT': '0', 'EFFI_RETENCIONES': ''}):
            out = effi_api.construir_pedido(135, '100', 100, 'LINDATEXTIL')
        c, r = out['cuerpo'], out['resumen']
        self.assertEqual(c['articulo'], ['6082'])             # no confunde 100 con 1000
        self.assertEqual(c['proveedor'], 381)
        self.assertEqual(c['t_forma_pago'], [4])               # la del proveedor
        self.assertEqual(c['impuestos'], {'1': [16]})
        self.assertEqual(c['idempotency_key'], 'zeus-oc-135')
        self.assertEqual(r['bruto'], 793000.0)
        self.assertAlmostEqual(r['total'], 943670.0, places=2)   # 793.000 + 19 %
        self.assertEqual(c['valor_forma_pago'], [r['total']])
        self.assertEqual(c['id_ciudad_proveedor'], 12601)

    def test_reproduce_el_total_de_la_orden_133_de_effi(self):
        # orden real de prueba: bruto 793.000, descuento 12 %, IVA 19 % y retención 2,5 % -> total neto 812.983,60
        with mock.patch.dict(os.environ, {'EFFI_DESCUENTO_PCT': '12', 'EFFI_RETENCIONES': '5'}):
            r = effi_api.construir_pedido(133, '100', 100, 'LINDATEXTIL')['resumen']
        self.assertEqual(r['descuento'], 95160.0)
        self.assertEqual(r['impuestos'], 132589.6)
        self.assertEqual(r['retenciones'], 17446.0)
        self.assertAlmostEqual(r['total'], 812983.6, places=2)

    def test_sin_referencia_exacta_falla(self):
        with self.assertRaises(effi_api.EffiError):
            effi_api.construir_pedido(1, '999', 10, 'LINDATEXTIL')

    def test_reintento_409_devuelve_la_orden_ya_creada(self):
        def post(metodo, ruta, params=None, cuerpo=None, reintento=True):
            raise effi_api.EffiError('ya existe', 409, {'ok': False, 'data': {'id': 136, 'id_transaccion': 'PPAL-136', 'total': '943670.00'}})
        with mock.patch.dict(os.environ, {'EFFI_DESCUENTO_PCT': '0', 'EFFI_RETENCIONES': ''}), mock.patch.object(effi_api, '_peticion', side_effect=post):
            r = effi_api.crear_orden(136, '100', 100, 'LINDATEXTIL')
        self.assertEqual(r['oc'], '136')


if __name__ == '__main__':
    unittest.main()
