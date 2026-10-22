"""ZEUS: la lista de compras sigue a la tela que falta (sin duplicar, sin pedir de más, cancelando lo que ya alcanza)."""
import os
import sys
from unittest import mock
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['ZEUS_FILE'] = str(Path(tempfile.mkdtemp()) / 'zeus.json')

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import zeus  # noqa: E402


ORIGINAL_ENVIO = zeus._enviar_verificacion


def falta(orden, tela, mts, ref='A700CA00'):
    return {'orden': orden, 'cliente': 'CLIENTE', 'proyecto': 'PROY', 'referencia': ref, 'tela': tela, 'mts': mts + 10, 'falta': mts,
            'entrega': '2026-11-03', 'situacion': 'no_alcanza', 'telas': ['(700) TOUR']}


class ZeusTest(unittest.TestCase):
    def setUp(self):
        zeus._enviar_verificacion = ORIGINAL_ENVIO
        zeus._file.unlink(missing_ok=True)
        self.lista = []
        self.correos = []
        zeus.configurar(lambda: self.lista, lambda request: None)
        zeus._correo_creada = lambda item: self.correos.append(item)
        app = FastAPI()
        app.include_router(zeus.pc_router)
        app.include_router(zeus.router)
        app.include_router(zeus.public_router)
        self.pc = TestClient(app)
        self.permitido = True
        zeus.configurar(lambda: self.lista, lambda request: None, lambda request: 'Indoor Sport', lambda u: self.permitido)

    def test_agrupa_por_tela_y_no_duplica(self):
        self.lista = [falta('RM1', 'TOUR', 30), falta('RM2', 'TOUR', 20), falta('RM3', 'DIAMANTE', 5)]
        self.assertEqual(zeus.sincronizar()['nuevas'], 2)
        self.assertEqual(zeus.sincronizar()['nuevas'], 0)
        items = {i['tela']: i for i in zeus._leer()['items']}
        self.assertEqual(items['TOUR']['falta'], 50.0)
        self.assertEqual(len(items['TOUR']['ordenes']), 2)

    def test_actualiza_lo_que_falta_de_una_compra_pendiente(self):
        self.lista = [falta('RM1', 'TOUR', 26)]
        zeus.sincronizar()
        self.lista = [falta('RM1', 'TOUR', 60)]   # el cálculo se afinó (talla por talla)
        zeus.sincronizar()
        self.assertEqual(zeus._leer()['items'][0]['falta'], 60.0)

    def test_cancela_si_ya_alcanza(self):
        self.lista = [falta('RM1', 'TOUR', 30)]
        zeus.sincronizar()
        self.lista = []
        self.assertEqual(zeus.sincronizar()['canceladas'], 1)
        self.assertEqual(zeus._leer()['items'][0]['estado'], 'cancelada')

    def test_sondeo_entrega_solo_si_puede_trabajar_y_registra_la_orden(self):
        self.lista = [falta('RM1', 'TOUR', 30)]
        zeus.sincronizar()
        sin = self.pc.post('/api/zeus/pc/sondeo', json={'estado': 'ESPERANDO_EFFI', 'puede_trabajar': False}).json()
        self.assertEqual(sin['trabajos'], [])
        con = self.pc.post('/api/zeus/pc/sondeo', json={'estado': 'LIBRE', 'puede_trabajar': True}).json()
        self.assertEqual(len(con['trabajos']), 1)
        self.assertEqual(con['trabajos'][0]['falta'], 30.0)
        self.pc.post('/api/zeus/pc/sondeo', json={'estado': 'LIBRE', 'resultados': [{'id': con['trabajos'][0]['id'], 'ok': True, 'oc': 'OC-77'}]})
        item = zeus._leer()['items'][0]
        self.assertEqual((item['estado'], item['oc']), ('creada', 'OC-77'))
        self.assertEqual(len(self.correos), 1)

    def test_pide_solo_la_diferencia_despues_de_una_compra(self):
        self.lista = [falta('RM1', 'TOUR', 30)]
        zeus.sincronizar()
        job = self.pc.post('/api/zeus/pc/sondeo', json={'puede_trabajar': True}).json()['trabajos'][0]
        self.pc.post('/api/zeus/pc/sondeo', json={'resultados': [{'id': job['id'], 'ok': True, 'oc': 'OC-1'}]})
        self.lista = [falta('RM1', 'TOUR', 30), falta('RM2', 'TOUR', 12)]   # ahora falta 42: ya se pidieron 30
        self.assertEqual(zeus.sincronizar()['nuevas'], 1)
        nuevo = [i for i in zeus._leer()['items'] if i['estado'] == 'pendiente'][0]
        self.assertEqual(nuevo['falta'], 12.0)

    def test_error_se_reintenta_y_no_se_pierde(self):
        self.lista = [falta('RM1', 'TOUR', 30)]
        zeus.sincronizar()
        job = self.pc.post('/api/zeus/pc/sondeo', json={'puede_trabajar': True}).json()['trabajos'][0]
        self.pc.post('/api/zeus/pc/sondeo', json={'resultados': [{'id': job['id'], 'ok': False, 'detalle': 'Effi no respondió'}]})
        item = zeus._leer()['items'][0]
        self.assertEqual((item['estado'], item['intentos']), ('error', 1))
        self.assertIn('Effi', item['detalle'])

    def _con_envio_falso(self):
        self.enviados = []
        zeus._enviar_verificacion = lambda correo, token, pidio: self.enviados.append((correo, token)) or ''

    def test_correo_nuevo_queda_pendiente_hasta_que_su_dueno_confirma(self):
        self._con_envio_falso()
        r = self.pc.post('/api/zeus/correos', json={'correo': ' Compras@Indoor.com '})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['enviado'])
        self.assertEqual([(c['correo'], c['estado']) for c in r.json()['correos']], [('compras@indoor.com', 'pendiente')])
        self.assertNotIn('token', str(r.json()))                       # el navegador nunca recibe el token
        self.assertNotIn('compras@indoor.com', zeus.destinatarios())   # sin confirmar no recibe ordenes
        (correo, token), = self.enviados
        malo = self.pc.get('/api/zeus/confirmar', params={'c': correo, 't': 'otro-token'})
        self.assertEqual(malo.status_code, 400)
        bueno = self.pc.get('/api/zeus/confirmar', params={'c': correo, 't': token})
        self.assertEqual(bueno.status_code, 200)
        self.assertIn('compras@indoor.com', zeus.destinatarios())
        self.assertEqual(self.pc.get('/api/zeus/confirmar', params={'c': correo, 't': token}).status_code, 400)   # el enlace sirve una sola vez

    def test_enlace_vencido_no_confirma(self):
        self._con_envio_falso()
        self.pc.post('/api/zeus/correos', json={'correo': 'a@b.co'})
        (correo, token), = self.enviados
        d = zeus._leer()
        d['config']['correos'][0]['enviado_at'] -= zeus.CONFIRMA_VENCE_SEG + 5
        zeus._guardar(d)
        self.assertEqual(self.pc.get('/api/zeus/confirmar', params={'c': correo, 't': token}).status_code, 400)
        self.assertEqual(zeus._leer()['config']['correos'][0]['estado'], 'pendiente')

    def test_validaciones_duplicados_reenvio_y_quitar(self):
        self._con_envio_falso()
        self.assertEqual(self.pc.post('/api/zeus/correos', json={'correo': 'no-es-correo'}).status_code, 400)
        self.pc.post('/api/zeus/correos', json={'correo': 'a@b.co'})
        self.assertEqual(self.pc.post('/api/zeus/correos', json={'correo': 'A@B.co'}).status_code, 409)
        self.assertEqual(self.pc.post('/api/zeus/correos/reenviar', json={'correo': 'a@b.co'}).status_code, 429)   # hay que esperar un minuto
        d = zeus._leer()
        d['config']['correos'][0]['enviado_at'] -= 120
        zeus._guardar(d)
        self.assertEqual(self.pc.post('/api/zeus/correos/reenviar', json={'correo': 'a@b.co'}).status_code, 200)
        self.assertEqual(len(self.enviados), 2)
        self.assertNotEqual(self.enviados[0][1], self.enviados[1][1])   # cada mensaje trae un enlace nuevo
        self.assertEqual(self.pc.delete('/api/zeus/correos', params={'correo': 'a@b.co'}).status_code, 200)
        self.assertEqual(self.pc.get('/api/zeus/config').json()['correos'], [])

    def test_sin_cuenta_de_correo_queda_pendiente_con_el_motivo(self):
        from app import alertas_correo
        with mock.patch.object(alertas_correo, 'puede_enviar', return_value=False):   # sin cuenta de correo configurada (no depende del .env de cada máquina)
            r = self.pc.post('/api/zeus/correos', json={'correo': 'a@b.co'}).json()
        self.assertFalse(r['enviado'])
        self.assertIn('correo', r['detalle'].lower())
        self.assertEqual(r['correos'][0]['estado'], 'pendiente')

    def test_solo_administracion_cambia_los_correos(self):
        self._con_envio_falso()
        self.permitido = False
        self.assertEqual(self.pc.post('/api/zeus/correos', json={'correo': 'a@b.co'}).status_code, 403)
        self.assertEqual(self.pc.delete('/api/zeus/correos', params={'correo': 'a@b.co'}).status_code, 403)


class CuentaCorreoTest(unittest.TestCase):
    def test_usa_la_cuenta_que_el_panel_ya_tiene_si_no_hay_otra(self):
        from app import alertas_correo
        viejo = dict(os.environ)
        try:
            for k in ('ALERTA_SMTP_USER', 'ALERTA_SMTP_PASSWORD', 'ALERTA_SMTP_HOST', 'ALERTA_SMTP_PORT'):
                os.environ.pop(k, None)
            os.environ.update({'SMTP_EMAIL': 'panel@indoor.co', 'SMTP_PASSWORD': 'clave-del-panel', 'SMTP_SERVER': 'smtp.ejemplo.co', 'SMTP_PORT': '587',
                               'CORREO_CUENTA_FILE': str(Path(tempfile.mkdtemp()) / 'no-existe.json')})
            alertas_correo.CUENTA_FILE = Path(os.environ['CORREO_CUENTA_FILE'])
            self.assertEqual(alertas_correo.cuenta(), ('panel@indoor.co', 'clave-del-panel'))
            self.assertTrue(alertas_correo.puede_enviar())
            self.assertEqual(alertas_correo.servidor(), ('smtp.ejemplo.co', 587))
            os.environ.update({'ALERTA_SMTP_USER': 'agente@indoor.co', 'ALERTA_SMTP_PASSWORD': 'otra'})   # lo del .env de alertas manda
            self.assertEqual(alertas_correo.cuenta(), ('agente@indoor.co', 'otra'))
        finally:
            os.environ.clear()
            os.environ.update(viejo)


if __name__ == '__main__':
    unittest.main()
