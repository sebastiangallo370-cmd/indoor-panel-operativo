import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['WHATSAPP_WORKER_TOKEN'] = 'x' * 40

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app import whatsapp_notificaciones as wa  # noqa: E402


class WhatsAppQueueTest(unittest.TestCase):
    def setUp(self):
        wa._db_file = Path(tempfile.mkdtemp()) / 'wa.sqlite3'
        wa.configurar(lambda request: 'Indoor Sport', lambda user: user == 'Indoor Sport')
        app = FastAPI()
        app.include_router(wa.router)
        app.include_router(wa.worker_router)
        self.client = TestClient(app)
        self.headers = {'X-WhatsApp-Worker-Token': 'x' * 40}

    def _authorize(self):
        return self.client.post('/api/whatsapp/recipients', json={'phone': '3113351601', 'name': 'Prueba', 'authorized': True})

    def test_normaliza_colombia_y_exige_autorizacion(self):
        self.assertEqual(wa.normalizar_telefono('311 335 1601'), '+573113351601')
        self.assertEqual(self._authorize().status_code, 200)
        row = self.client.post('/api/whatsapp/test', json={'phone': '+573113351601', 'text': 'prueba'})
        self.assertEqual(row.status_code, 200)
        self.assertEqual(row.json()['status'], 'pending')

    def test_modo_prueba_prepara_y_no_envia(self):
        self._authorize()
        self.client.post('/api/whatsapp/config', json={'enabled': True, 'test_mode': True})
        self.client.post('/api/whatsapp/test', json={'phone': '3113351601', 'text': 'prueba'})
        job = self.client.post('/api/whatsapp/worker/claim', headers=self.headers).json()['message']
        self.assertTrue(job['test_mode'])
        r = self.client.post('/api/whatsapp/worker/complete', headers=self.headers, json={'id': job['id'], 'status': 'prepared'})
        self.assertEqual(r.json()['status'], 'prepared')
        self.assertEqual(self.client.post('/api/whatsapp/worker/claim', headers=self.headers).json()['message'], None)

    def test_sent_needs_evidence_and_lease_is_uncertain(self):
        self._authorize()
        self.client.post('/api/whatsapp/config', json={'enabled': True, 'test_mode': False})
        self.client.post('/api/whatsapp/test', json={'phone': '3113351601', 'text': 'prueba'})
        job = self.client.post('/api/whatsapp/worker/claim', headers=self.headers).json()['message']
        self.assertEqual(self.client.post('/api/whatsapp/worker/complete', headers=self.headers, json={'id': job['id'], 'status': 'sent'}).status_code, 400)
        self.assertEqual(self.client.post('/api/whatsapp/worker/complete', headers=self.headers, json={'id': job['id'], 'status': 'sent', 'evidence': 'botón Enviar aceptado'}).json()['status'], 'sent')

    def test_claim_is_one_at_a_time(self):
        self._authorize()
        self.client.post('/api/whatsapp/config', json={'enabled': True})
        self.client.post('/api/whatsapp/test', json={'phone': '3113351601', 'text': 'uno'})
        first = self.client.post('/api/whatsapp/worker/claim', headers=self.headers).json()['message']
        self.assertIsNotNone(first)
        self.assertIsNone(self.client.post('/api/whatsapp/worker/claim', headers=self.headers).json()['message'])


if __name__ == '__main__':
    unittest.main()
