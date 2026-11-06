"""MENÚ CO / MENÚ RM: cómo se leen las cotizaciones y remisiones que devuelve Effi (sin llamar a Effi)."""
import unittest
from unittest import mock

from app import ventas_effi


class DocumentoTest(unittest.TestCase):
    def test_cotizacion_con_nombres_junto_al_id(self):
        fila = {'id': '812', 'prefijo': 'CO', 'id_transaccion': 'CO-812', 'fecha_trans': '2026-10-20 09:15:00',
                'fecha_entrega': '2026-10-30', 'cliente': '900123', 'nombre_cliente': 'CLUB DEPORTIVO DEMO',
                'vendedor': '5', 'nombre_vendedor': 'Ana', 'total': '119000.0000', 'est_cotizacion': '3',
                'garantia': 'Uniforme 2026', 'vigencia': 'Vigente'}
        d = ventas_effi._documento(fila, 'cotizacion')
        self.assertEqual(d['numero'], 'CO-812')
        self.assertEqual(d['cliente'], 'CLUB DEPORTIVO DEMO')
        self.assertEqual(d['vendedor'], 'Ana')
        self.assertEqual(d['total'], 119000.0)
        self.assertEqual(d['estado'], 'Convertida a remisión')
        self.assertEqual(d['proyecto'], 'Uniforme 2026')
        self.assertTrue(d['vigente'])
        self.assertEqual(d['campos']['nombre_cliente'], 'CLUB DEPORTIVO DEMO')

    def test_remision_anulada_sin_id_transaccion(self):
        d = ventas_effi._documento({'id': '45', 'prefijo': 'RM', 'est_remision_v': 2, 'vigente': 0, 'pdte_cobro': '1.500,00'.replace('.', '').replace(',', '.')}, 'remision')
        self.assertEqual(d['numero'], 'RM-45')
        self.assertEqual(d['estado'], 'Facturada')
        self.assertFalse(d['vigente'])
        self.assertEqual(d['saldo'], 1500.0)

    def test_cliente_como_objeto_y_campos_raros(self):
        d = ventas_effi._documento({'id': 1, 'cliente': {'nombre': 'ACME'}, 'extra': [1, 2], 'vacio': ''}, 'cotizacion')
        self.assertEqual(d['cliente'], 'ACME')
        self.assertNotIn('extra', d['campos'])
        self.assertNotIn('vacio', d['campos'])
        self.assertEqual(d['estado'], '')


class RutaDocumentosTest(unittest.TestCase):
    def setUp(self):
        ventas_effi._documentos_cache.clear()
        self.peticion = mock.patch.object(ventas_effi.effi_api, '_peticion', return_value={'data': [{'id': '1', 'est_cotizacion': 1}]})
        self.llave = mock.patch.object(ventas_effi, '_con_llave', lambda: None)
        self.usuario = mock.patch.object(ventas_effi, '_usuario', lambda request: 'Indoor Sport')
        self.llamada = self.peticion.start(); self.llave.start(); self.usuario.start()

    def tearDown(self):
        mock.patch.stopall()

    def test_lista_y_guarda_un_minuto(self):
        r = ventas_effi.documentos(None, 'cotizacion', 1)
        self.assertEqual(r['documentos'][0]['estado'], 'Pendiente de venta')
        self.assertFalse(r['hay_mas'])
        ventas_effi.documentos(None, 'cotizacion', 1)
        self.assertEqual(self.llamada.call_count, 1)
        self.assertEqual(self.llamada.call_args[0][1], 'cotizacion')

    def test_remision_usa_recurso_de_effi(self):
        ventas_effi.documentos(None, 'remision', 2)
        self.assertEqual(self.llamada.call_args[0][1], 'remision_v')
        self.assertEqual(self.llamada.call_args[0][2]['pagina'], 2)

    def test_tipo_invalido(self):
        with self.assertRaises(ventas_effi.HTTPException):
            ventas_effi.documentos(None, 'factura', 1)


if __name__ == '__main__':
    unittest.main()
