import tempfile
import unittest
from pathlib import Path

from app import requerimientos_tela as rq

EV = {'clave': 'prod|1621|RM7648|A700CA00', 'tipo': 'no_alcanza', 'cliente': 'SANTIAGO JARAMILLO CORREA', 'proyecto': 'CAMISETAS', 'referencia': 'A700CA00',
      'tela': 'TOUR', 'mts': 156.0, 'disponible': 64.0, 'falta': 91.2, 'orden': 'RM7648'}


class Requerimientos(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.enviados = []

    def tearDown(self):
        self.d.cleanup()

    def _enviar(self, asunto, cuerpo, para=None):
        self.enviados.append((asunto, cuerpo, para))

    def test_envia_una_sola_vez_por_produccion(self):
        self.assertEqual(rq.enviar_pendientes(self.d.name, [EV], self._enviar, 'jefe@x.co'), [EV['clave']])
        self.assertEqual(rq.enviar_pendientes(self.d.name, [EV], self._enviar, 'jefe@x.co'), [])
        self.assertEqual(len(self.enviados), 1)
        e = rq.estado(self.d.name, EV['clave'])
        self.assertEqual((e['estado'], e['para']), ('enviado', 'j***@x.co'))
        self.assertTrue(e['hora'])

    def test_el_correo_dice_cuanta_tela_falta_redondeada_hacia_arriba(self):
        rq.enviar_pendientes(self.d.name, [EV], self._enviar, 'jefe@x.co')
        asunto, cuerpo, para = self.enviados[0]
        self.assertIn('faltan 92 MTS', asunto)
        self.assertIn('TELA QUE FALTA : 92 MTS', cuerpo)
        self.assertIn('SANTIAGO JARAMILLO CORREA', cuerpo)
        self.assertEqual(para, 'jefe@x.co')

    def test_si_falla_se_reintenta_despues_de_10_minutos_y_se_avisa(self):
        def falla(*a, **k):
            raise RuntimeError('SMTP caído')
        rq.enviar_pendientes(self.d.name, [EV], falla, 'jefe@x.co', ahora=1000)
        self.assertEqual(rq.estado(self.d.name, EV['clave'])['estado'], 'error')
        self.assertEqual(rq.enviar_pendientes(self.d.name, [EV], self._enviar, 'jefe@x.co', ahora=1100), [])   # muy pronto
        self.assertEqual(rq.enviar_pendientes(self.d.name, [EV], self._enviar, 'jefe@x.co', ahora=1000 + 601), [EV['clave']])
        self.assertEqual(rq.estado(self.d.name, EV['clave'])['estado'], 'enviado')

    def test_sin_destinatario_no_envia_nada(self):
        self.assertEqual(rq.enviar_pendientes(self.d.name, [EV], self._enviar, ''), [])
        self.assertEqual(self.enviados, [])
        self.assertEqual(rq.estado(self.d.name, EV['clave'])['estado'], 'pendiente')

    def test_destino_usa_la_variable_o_la_cuenta_de_envio(self):
        import os
        os.environ.pop('REQUERIMIENTO_TELA_EMAIL', None)
        self.assertEqual(rq.destino('envio@x.co'), 'envio@x.co')
        os.environ['REQUERIMIENTO_TELA_EMAIL'] = 'compras@x.co'
        try:
            self.assertEqual(rq.destino('envio@x.co'), 'compras@x.co')
        finally:
            os.environ.pop('REQUERIMIENTO_TELA_EMAIL')


if __name__ == '__main__':
    unittest.main()
