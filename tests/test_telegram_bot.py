import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import telegram_bot as tb  # noqa: E402
from app import permisos as permisos_mod  # noqa: E402


class BotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [
            mock.patch.object(tb, 'ESTADO_DIR', self.tmp),
            mock.patch.object(tb, 'VINCULOS', self.tmp / 'vinculos.json'),
            mock.patch.object(tb, 'CODIGOS', self.tmp / 'codigos.json'),
            mock.patch.object(tb, 'CHATS', self.tmp / 'chats.json'),
            mock.patch.dict(os.environ, {'TELEGRAM_BOT_TOKEN': '123:TEST', 'TELEGRAM_ACTIVO': '1', 'TELEGRAM_CREAR_ACTIVO': '0'}),
        ]
        for p in self.patches:
            p.start()
        self.enviados = []
        self.api = mock.patch.object(tb, '_api', side_effect=self._fake_api)
        self.api.start()

    def tearDown(self):
        self.api.stop()
        for p in self.patches:
            p.stop()

    def _fake_api(self, metodo, datos=None):
        if metodo == 'sendMessage':
            self.enviados.append(datos)
        return {'ok': True, 'result': {}}

    def update_texto(self, texto, telegram_id=555, chat_id=555):
        return {'message': {'chat': {'id': chat_id}, 'from': {'id': telegram_id, 'first_name': 'Ana'}, 'text': texto}}

    def test_usuario_sin_vincular_recibe_codigo(self):
        tb.manejar_update(self.update_texto('/start'))
        self.assertIn('<b>', self.enviados[-1]['text'])
        codigo = self.enviados[-1]['text'].split('<b>')[1].split('</b>')[0]
        self.assertEqual(len(codigo), 6)

    def test_codigo_vincula_la_cuenta(self):
        tb.manejar_update(self.update_texto('/start'))
        codigo = self.enviados[-1]['text'].split('<b>')[1].split('</b>')[0]
        r = tb.vincular(codigo, 'comercial1')
        self.assertTrue(r['ok'])
        self.assertEqual(tb.usuario_vinculado(555), 'comercial1')
        # el código se usa una sola vez
        with self.assertRaises(tb.HTTPException):
            tb.vincular(codigo, 'otro')

    def test_codigo_incorrecto_no_vincula(self):
        with self.assertRaises(tb.HTTPException):
            tb.vincular('000000', 'comercial1')
        self.assertEqual(tb.usuario_vinculado(555), '')

    def test_vinculado_puede_empezar_cotizacion(self):
        tb.vincular(self._codigo_de(555), 'comercial1')
        tb.manejar_update(self.update_texto('/cotizar'))
        self.assertIn('cliente', self.enviados[-1]['text'].lower())

    def test_no_vinculado_no_avanza(self):
        tb.manejar_update(self.update_texto('/cotizar'))
        self.assertIn('no está vinculada', self.enviados[-1]['text'])

    def test_crear_apagado_por_defecto(self):
        tb.vincular(self._codigo_de(555), 'comercial1')
        tb._guardar_estado(555, {'paso': 'resumen', 'tipo': 'cotizacion', 'cliente': 'X', 'lineas': [], 'pago': 'Contado'})
        with mock.patch.object(permisos_mod, 'comerciales_permitido', return_value=True):
            tb.manejar_update({'callback_query': {'id': '1', 'from': {'id': 555}, 'message': {'chat': {'id': 555}}, 'data': 'crear'}})
        self.assertIn('apagada', self.enviados[-1]['text'])

    def test_crear_exige_permiso_de_comercial(self):
        tb.vincular(self._codigo_de(555), 'almacen')
        tb._guardar_estado(555, {'paso': 'resumen', 'tipo': 'cotizacion', 'cliente': 'X', 'lineas': [], 'pago': 'Contado'})
        with mock.patch.dict(os.environ, {'TELEGRAM_CREAR_ACTIVO': '1'}), \
                mock.patch.object(permisos_mod, 'comerciales_permitido', return_value=False):
            tb.manejar_update({'callback_query': {'id': '1', 'from': {'id': 555}, 'message': {'chat': {'id': 555}}, 'data': 'crear'}})
        self.assertIn('no tiene permiso', self.enviados[-1]['text'])

    def test_inactivo_no_responde(self):
        with mock.patch.dict(os.environ, {'TELEGRAM_ACTIVO': '0'}):
            self.assertFalse(tb.activo())

    def _codigo_de(self, telegram_id):
        tb.manejar_update(self.update_texto('/start', telegram_id=telegram_id, chat_id=telegram_id))
        return self.enviados[-1]['text'].split('<b>')[1].split('</b>')[0]


if __name__ == '__main__':
    unittest.main()
