"""Probar una llave nueva de Effi no debe depender de la llave global (otros hilos la reponen en cada vuelta)."""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import effi_api  # noqa: E402

BUENA, VIEJA = 'B' * 36, 'V' * 36


class _Effi(BaseHTTPRequestHandler):
    agentes: list = []

    def do_GET(self):
        _Effi.agentes.append(self.headers.get('User-Agent') or '')
        llave = (self.headers.get('Authorization') or '').replace('Bearer ', '')
        if llave == BUENA:
            codigo, cuerpo = 200, {'ok': True, 'data': [{'id': 1, 'nombre': 'Principal'}]}
        elif llave == VIEJA:
            codigo, cuerpo = 403, {'ok': False, 'mensaje': 'La API key no tiene permiso para esa función.'}
        else:
            codigo, cuerpo = 401, {'ok': False}
        datos = json.dumps(cuerpo).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def log_message(self, *a):
        pass


class ProbarLlave(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(('127.0.0.1', 0), _Effi)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = effi_api.BASE
        effi_api.BASE = f'http://127.0.0.1:{cls.srv.server_port}'

    @classmethod
    def tearDownClass(cls):
        effi_api.BASE = cls.base
        cls.srv.shutdown()

    def tearDown(self):
        effi_api.usar_llave('')

    def test_llave_buena_pasa_aunque_la_global_sea_la_vieja(self):
        effi_api.usar_llave(VIEJA)   # lo que dejan los otros hilos
        effi_api.probar_llave(BUENA)   # no debe lanzar
        self.assertEqual(effi_api.llave(), VIEJA)   # y no toca la global

    def test_pisada_de_otro_hilo_no_afecta(self):
        parar = threading.Event()

        def pisar():
            while not parar.is_set():
                effi_api.usar_llave(VIEJA)

        h = threading.Thread(target=pisar, daemon=True)
        h.start()
        try:
            for _ in range(30):
                effi_api.probar_llave(BUENA)
        finally:
            parar.set()
            h.join()

    def test_llave_mala_da_mensaje_con_estado(self):
        with self.assertRaises(effi_api.EffiError) as cm:
            effi_api.probar_llave(VIEJA)
        self.assertEqual(cm.exception.estado, 403)
        self.assertIn('403', str(cm.exception))
        self.assertIn('sucursal', str(cm.exception))

    def test_no_se_identifica_como_python_urllib(self):
        """Cloudflare rechaza (403, error 1010) el User-Agent «Python-urllib»: el cliente debe mandar el de curl."""
        _Effi.agentes.clear()
        effi_api.probar_llave(BUENA)
        self.assertTrue(_Effi.agentes and all(a.startswith('curl/') for a in _Effi.agentes), _Effi.agentes)

    def test_peticion_normal_sigue_usando_la_global(self):
        effi_api.usar_llave(BUENA)
        self.assertEqual(len(effi_api._lista('sucursal')), 1)
        effi_api.usar_llave(VIEJA)
        with self.assertRaises(effi_api.EffiError):
            effi_api._lista('sucursal')


if __name__ == '__main__':
    unittest.main()
