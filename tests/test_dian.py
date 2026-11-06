import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import dian


class DianTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI(); app.include_router(dian.router); self.client = TestClient(app)

    def test_prepara_cufes_sin_exponer_token(self):
        cufe = 'a' * 96
        response = self.client.post('/api/dian/preparar', json={'token': 'secreto-de-prueba', 'cufes': 'orden\t' + cufe + '\n' + cufe, 'carpeta': '2026/noviembre'})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual((data['total'], data['duplicados'], data['carpeta']), (1, 1, '2026/noviembre'))
        self.assertNotIn('secreto-de-prueba', str(data))

    def test_rechaza_lote_sin_token_cufe_o_carpeta_insegura(self):
        self.assertEqual(self.client.post('/api/dian/preparar', json={'cufes': 'a' * 96}).status_code, 400)
        self.assertEqual(self.client.post('/api/dian/preparar', json={'token': 'x', 'cufes': 'no es cufe'}).status_code, 400)
        self.assertEqual(self.client.post('/api/dian/preparar', json={'token': 'x', 'cufes': 'a' * 96, 'carpeta': '../afuera'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
