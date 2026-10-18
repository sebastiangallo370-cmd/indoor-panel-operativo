"""El webhook de Effi (orden de venta creada) despierta a ALMA; sin el código secreto no responde."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import ecommerce_canal as ec


class Peticion:
    def __init__(self, cuerpo: bytes):
        self._c = cuerpo

    async def body(self):
        return self._c


class Webhook(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(ec, '_file', base / 'ecommerce.json'), mock.patch.object(ec, '_wh_token_file', base / 'token.txt')]
        for m in self.p:
            m.start()
        d = ec._leer()
        d['latido'] = {'at': ec._ahora(), 'iso': ec._iso(), 'equipo': 'PC'}
        d['agentes']['alma'] = {'estado': 'CORRIENDO'}
        ec._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_token_estable_y_largo(self):
        t = ec.token_webhook()
        self.assertGreaterEqual(len(t), 32)
        self.assertEqual(ec.token_webhook(), t)

    def test_aviso_valido_despierta_a_alma(self):
        t = ec.token_webhook()
        r = asyncio.run(ec.webhook_effi(t, Peticion(b'{"evento":"orden_v.crear","data":{"id_transaccion":"PPAL-1220"}}')))
        self.assertTrue(r['ok'])
        d = ec._leer()
        revisar = [o for o in d['ordenes'] if o['accion'] == 'revisar']
        self.assertEqual(len(revisar), 1)
        self.assertIn('webhook', revisar[0]['por'])
        self.assertEqual(d['webhook']['orden'], 'PPAL-1220')
        asyncio.run(ec.webhook_effi(t, Peticion(b'{}')))   # otro aviso con la revisión aún en espera: no se duplica
        self.assertEqual(len([o for o in ec._leer()['ordenes'] if o['accion'] == 'revisar']), 1)

    def test_codigo_incorrecto_no_responde(self):
        with self.assertRaises(HTTPException) as e:
            asyncio.run(ec.webhook_effi('x' * 43, Peticion(b'{}')))
        self.assertEqual(e.exception.status_code, 404)
        self.assertFalse([o for o in ec._leer()['ordenes'] if o['accion'] == 'revisar'])

    def test_cuerpo_que_no_es_json_tambien_sirve(self):
        t = ec.token_webhook()
        self.assertTrue(asyncio.run(ec.webhook_effi(t, Peticion(b'esto no es json')))['ok'])


if __name__ == '__main__':
    unittest.main()
