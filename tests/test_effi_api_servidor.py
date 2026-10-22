"""La API de Effi del servidor (app/effi_api.py): la forma de pago es el total de Effi, que por la API no descuenta la retención."""
import os
import unittest
from unittest import mock

from app import effi_api


def lista_falsa(ruta, params=None):
    if ruta == 'proveedor':
        return [{'tercero': '381', 'nombre': 'TEJIDOS DE PUNTO LINDATEXTIL S.A.S', 't_forma_pago': '4',
                 'direcciones': [{'id': '1', 'id_pais': '47', 'id_provincia': '776', 'id_ciudad': '12601', 'direccion': 'AUT MED-BTA KM 37', 'referencia': ''}]}]
    if ruta == 'articulo':
        return [{'id': '6082', 'referencia': '100', 'descripcion': '903385 MONTECATINI DB BCO 1A', 'p_costo_ultimo': '7930.0000', 'impuesto': 'IVA 19%'},
                {'id': '9999', 'referencia': '100', 'descripcion': 'OTRO CON LA MISMA REFERENCIA', 'p_costo_ultimo': '1', 'impuesto': None}]
    if ruta == 'impuesto':
        return [{'id': '16', 'nombre': 'IVA 19% compras', 'etiqueta': 'IVA 19%', 'tipo_calculo': 'Porcentaje', 'valor': '19.000'}]
    if ruta == 'retencion':
        return [{'id': '1', 'nombre': 'Compras 2.5%', 'etiqueta': 'RETE FUENTE', 'tipo_calculo': 'Sobre base', 'valor': '2.500', 'base': '524000.00', 'base_excluida': '0.00', 'base_maxima': '0.00'}]
    return []


class PedidoServidor(unittest.TestCase):
    def setUp(self):
        self.p = [mock.patch.object(effi_api, '_lista', side_effect=lista_falsa), mock.patch.dict(os.environ, {'EFFI_API_KEY': 'x' * 40, 'EFFI_DESCUENTO_PCT': '12', 'EFFI_RETENCIONES': '1'}, clear=False)]
        for m in self.p:
            m.start()

    def tearDown(self):
        for m in self.p:
            m.stop()

    def test_la_forma_de_pago_es_el_total_de_effi_sin_descontar_la_retencion(self):
        # orden 143 real: Effi pidió $830.429,60 aunque la retención (2,5 %) daría un neto de $812.983,60
        p = effi_api.construir_pedido('t', '100', 100, 'LINDATEXTIL')
        self.assertAlmostEqual(p['cuerpo']['valor_forma_pago'][0], 830429.6, places=2)
        self.assertEqual(p['resumen']['retenciones'], 17446.0)
        self.assertAlmostEqual(p['resumen']['neto_con_retencion'], 812983.6, places=2)

    def test_con_id_de_effi_se_toma_ese_articulo_aunque_la_referencia_se_repita(self):
        with mock.patch.object(effi_api, '_lista', side_effect=lambda ruta, params=None: [a for a in lista_falsa(ruta) if not params or 'id' not in params or a['id'] == params['id']]):
            self.assertEqual(effi_api.articulo('100', '6082')['id'], '6082')
            with self.assertRaises(effi_api.EffiError):
                effi_api.articulo('100', '1234')   # un ID que no existe no se cambia por la referencia


if __name__ == '__main__':
    unittest.main()
