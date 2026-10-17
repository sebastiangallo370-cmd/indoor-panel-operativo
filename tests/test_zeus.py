"""ZEUS: la lista de compras sigue a la tela que falta (sin duplicar, sin pedir de más, cancelando lo que ya alcanza)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['ZEUS_FILE'] = str(Path(tempfile.mkdtemp()) / 'zeus.json')

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import zeus  # noqa: E402


def falta(orden, tela, mts, ref='A700CA00'):
    return {'orden': orden, 'cliente': 'CLIENTE', 'proyecto': 'PROY', 'referencia': ref, 'tela': tela, 'mts': mts + 10, 'falta': mts,
            'entrega': '2026-11-03', 'situacion': 'no_alcanza', 'telas': ['(700) TOUR']}


class ZeusTest(unittest.TestCase):
    def setUp(self):
        zeus._file.unlink(missing_ok=True)
        self.lista = []
        self.correos = []
        zeus.configurar(lambda: self.lista, lambda request: None)
        zeus._correo_creada = lambda item: self.correos.append(item)
        app = FastAPI()
        app.include_router(zeus.pc_router)
        app.include_router(zeus.router)
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

    def test_correos_se_validan_y_se_guardan(self):
        r = self.pc.post('/api/zeus/config', json={'correos': ['Compras@Indoor.com ', 'compras@indoor.com', 'otro@x.co']})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['correos'], ['compras@indoor.com', 'otro@x.co'])
        self.assertEqual(self.pc.get('/api/zeus/config').json()['correos'], ['compras@indoor.com', 'otro@x.co'])
        self.assertEqual(zeus.destinatarios(), 'compras@indoor.com, otro@x.co')
        self.assertEqual(self.pc.post('/api/zeus/config', json={'correos': ['no-es-correo']}).status_code, 400)
        self.assertEqual(self.pc.post('/api/zeus/config', json={'correos': ['a@b.co'] * 3 + [f'x{i}@b.co' for i in range(11)]}).status_code, 400)

    def test_solo_administracion_cambia_los_correos(self):
        self.permitido = False
        self.assertEqual(self.pc.post('/api/zeus/config', json={'correos': ['a@b.co']}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
