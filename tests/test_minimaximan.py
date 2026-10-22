import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import minimaximan


def tela(stock, minimo, maximo, proveedor='LINDATEXTIL'):
    return {'codigo': '100', 'nombre': 'MONTECATINI BLANCO', 'mts': stock, 'stock_minimo': str(minimo), 'stock_maximo': str(maximo), 'proveedor': proveedor}


class MinimaximanTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.parches = [mock.patch.object(minimaximan, '_file', Path(self.dir.name) / 'mm.json'), mock.patch.object(minimaximan, '_usar_api', lambda: True)]
        for p in self.parches:
            p.start()

    def tearDown(self):
        for p in self.parches:
            p.stop()
        self.dir.cleanup()

    def evaluar(self, t, por_recibir=0.0):
        with mock.patch.object(minimaximan.proveedores_tela, 'telas', lambda: [t]), mock.patch.object(minimaximan, '_por_recibir', lambda codigo: por_recibir):
            return minimaximan.evaluar()[0]

    def test_bajo_el_minimo_pide_lo_que_falta_para_llegar_al_maximo(self):
        f = self.evaluar(tela(250, 300, 500))   # mínimo 300, hay 250, máximo 500 -> pedir 250 (queda en 500)
        self.assertEqual((f['estado'], f['pedir']), ('pedir', 250.0))

    def test_en_el_minimo_o_por_encima_no_pide(self):
        self.assertEqual(self.evaluar(tela(300, 300, 500))['estado'], 'ok')
        self.assertEqual(self.evaluar(tela(450, 300, 500))['estado'], 'ok')

    def test_lo_que_ya_viene_en_camino_cuenta(self):
        self.assertEqual(self.evaluar(tela(250, 300, 500), por_recibir=100)['estado'], 'en_camino')   # 250 + 100 llega al mínimo
        f = self.evaluar(tela(100, 300, 500), por_recibir=100)   # 100 + 100 = 200 sigue bajo: pide hasta el máximo
        self.assertEqual((f['estado'], f['pedir']), ('pedir', 300.0))

    def test_sin_proveedor_o_sin_ver_a_effi_no_pide(self):
        self.assertEqual(self.evaluar(tela(250, 300, 500, proveedor=''))['estado'], 'sin_proveedor')
        with mock.patch.object(minimaximan.proveedores_tela, 'telas', lambda: [tela(250, 300, 500)]), mock.patch.object(minimaximan, '_por_recibir', lambda codigo: None):
            self.assertEqual(minimaximan.evaluar()[0]['estado'], 'sin_effi')

    def test_maximo_menor_que_el_minimo_se_marca(self):
        self.assertEqual(self.evaluar(tela(250, 300, 200))['estado'], 'revisar')


class AprobacionTest(unittest.TestCase):
    """La orden creada por MINIMAXIMAN solo sale al proveedor cuando una persona la aprueba."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.enviados = []
        from app import alertas_correo
        self.parches = [mock.patch.object(minimaximan, '_file', Path(self.dir.name) / 'mm.json'),
                        mock.patch.object(alertas_correo, 'puede_enviar', lambda: True),
                        mock.patch.object(alertas_correo, 'enviar', lambda asunto, cuerpo, para=None, adjuntos=None: self.enviados.append((asunto, cuerpo, para)))]
        for p in self.parches:
            p.start()
        minimaximan.configurar(lambda request: 'ADMIN', lambda u: True)
        e = minimaximan._leer()
        e['compras'] = [{'id': 1, 'codigo': '100', 'tela': 'MONTECATINI BLANCO', 'proveedor': 'LINDATEXTIL', 'metros': 250.0, 'estado': 'creada', 'oc': '133', 'stock': 250, 'minimo': 300, 'maximo': 500},
                        {'id': 2, 'codigo': '100', 'tela': 'MONTECATINI BLANCO', 'proveedor': 'LINDATEXTIL', 'metros': 50.0, 'estado': 'error', 'oc': ''}]
        minimaximan._guardar(e)

    def tearDown(self):
        for p in self.parches:
            p.stop()
        self.dir.cleanup()

    def con_correo(self, correo='ventas@lindatextil.com', vendedor='JADER'):
        return mock.patch.object(minimaximan.proveedores_tela, 'telas', lambda: [{'codigo': '100', 'correo': correo, 'vendedor': vendedor}])

    def test_envia_solo_al_aprobar_y_queda_registrado(self):
        self.assertEqual(self.enviados, [])   # crear la orden no envía nada al proveedor
        with self.con_correo():
            r = minimaximan.enviar_proveedor(object(), {'id': 1})
        self.assertEqual(r['correo'], 'ventas@lindatextil.com')
        self.assertEqual(len(self.enviados), 1)
        self.assertEqual(self.enviados[0][2], 'ventas@lindatextil.com')
        self.assertIn('133', self.enviados[0][1])
        self.assertIn('250', self.enviados[0][1])
        env = minimaximan._leer()['compras'][0]['envio_proveedor']
        self.assertEqual((env['estado'], env['por']), ('enviada', 'ADMIN'))

    def test_no_se_envia_dos_veces_ni_sin_correo_ni_sin_orden(self):
        from fastapi import HTTPException
        with self.con_correo():
            minimaximan.enviar_proveedor(object(), {'id': 1})
            with self.assertRaises(HTTPException) as dos:
                minimaximan.enviar_proveedor(object(), {'id': 1})
            self.assertEqual(dos.exception.status_code, 409)
            with self.assertRaises(HTTPException) as error:
                minimaximan.enviar_proveedor(object(), {'id': 2})   # la orden con error no existe en Effi
            self.assertEqual(error.exception.status_code, 404)
        with self.con_correo(correo=''):
            e = minimaximan._leer()
            e['compras'][0].pop('envio_proveedor', None)
            minimaximan._guardar(e)
            with self.assertRaises(HTTPException) as sin:
                minimaximan.enviar_proveedor(object(), {'id': 1})
            self.assertEqual(sin.exception.status_code, 400)
        self.assertEqual(len(self.enviados), 1)

    def test_anular_marca_la_orden_y_pausa_la_tela(self):
        llamadas = []
        with mock.patch.object(minimaximan, '_usar_api', lambda: True), mock.patch.object(minimaximan.effi_api, 'anular_orden', lambda oc, motivo: llamadas.append(oc)):
            minimaximan.anular(object(), {'id': 1})
        self.assertEqual(llamadas, ['133'])
        e = minimaximan._leer()
        self.assertEqual(e['compras'][0]['estado'], 'anulada')
        self.assertTrue(minimaximan._en_pausa('100'))   # no se vuelve a pedir sola de inmediato

    def test_modificar_anula_y_crea_otra_con_los_metros_nuevos(self):
        hechos = []
        with mock.patch.object(minimaximan, '_usar_api', lambda: True), \
                mock.patch.object(minimaximan.effi_api, 'construir_pedido', lambda *a, **k: hechos.append('valida')), \
                mock.patch.object(minimaximan.effi_api, 'anular_orden', lambda oc, motivo: hechos.append('anula ' + oc)), \
                mock.patch.object(minimaximan.effi_api, 'crear_orden', lambda item, ref, metros, prov, **k: hechos.append('crea %g' % metros) or {'oc': '140', 'detalle': 'x'}):
            minimaximan.modificar(object(), {'id': 1, 'metros': 400})
        self.assertEqual(hechos, ['valida', 'anula 133', 'crea 400'])
        c = minimaximan._leer()['compras'][0]
        self.assertEqual((c['oc'], c['metros'], c['estado']), ('140', 400.0, 'creada'))

    def test_una_orden_ya_enviada_no_se_anula_ni_se_modifica(self):
        from fastapi import HTTPException
        e = minimaximan._leer()
        e['compras'][0]['envio_proveedor'] = {'estado': 'enviada'}
        minimaximan._guardar(e)
        with mock.patch.object(minimaximan, '_usar_api', lambda: True):
            for f, p in ((minimaximan.anular, {'id': 1}), (minimaximan.modificar, {'id': 1, 'metros': 10})):
                with self.assertRaises(HTTPException) as r:
                    f(object(), p)
                self.assertEqual(r.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
