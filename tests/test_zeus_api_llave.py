"""La API key de Effi se guarda solo en el servidor, nunca se devuelve, solo la maneja la cuenta autorizada y viaja al agente con cada compra."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import effi_api, zeus

LLAVE = 'A' * 40


class LlaveApi(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(zeus, '_file', base / 'zeus.json'), mock.patch.object(zeus, '_secreto', base / 'secreto.json'),
                  mock.patch.object(zeus, '_auth', lambda request: 'Indoor Sport'), mock.patch.object(zeus, '_llave_ok', lambda u: u == 'Indoor Sport')]
        for m in self.p:
            m.start()

    def tearDown(self):
        effi_api.usar_llave('')
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_guardar_y_nunca_devolver_la_llave(self):
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': '1'}]):
            vista = zeus.api_guardar_llave(None, {'llave': LLAVE})
        self.assertTrue(vista['configurada'])
        self.assertEqual(vista['ultimos4'], 'AAAA')
        self.assertNotIn(LLAVE, json.dumps(vista))
        self.assertNotIn(LLAVE, json.dumps(zeus.estado()))      # la pantalla del agente tampoco la trae
        self.assertEqual(zeus._leer_secreto()['llave'], LLAVE)

    def test_llave_invalida_no_se_guarda(self):
        with mock.patch.object(effi_api, '_lista', side_effect=effi_api.EffiError('La API key no es válida', 401)):
            with self.assertRaises(HTTPException) as e:
                zeus.api_guardar_llave(None, {'llave': LLAVE})
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(zeus._leer_secreto(), {})
        with self.assertRaises(HTTPException):
            zeus.api_guardar_llave(None, {'llave': 'corta con espacios'})

    def test_otra_cuenta_no_puede(self):
        with mock.patch.object(zeus, '_auth', lambda request: 'MARIA'):
            for f, args in ((zeus.api_estado, ()), (zeus.api_guardar_llave, ({'llave': LLAVE},)), (zeus.api_quitar_llave, ())):
                with self.assertRaises(HTTPException) as e:
                    f(None, *args)
                self.assertEqual(e.exception.status_code, 403)

    def test_viaja_al_agente_con_los_ajustes(self):
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': '1'}]):
            zeus.api_guardar_llave(None, {'llave': LLAVE})
        zeus.api_ajustes(None, {'descuento_pct': '12', 'retenciones': [5]})
        api = zeus.api_para_agente(zeus._leer())
        self.assertEqual(api, {'llave': LLAVE, 'descuento_pct': 12.0, 'retenciones': [5]})
        zeus.api_quitar_llave(None)
        self.assertIsNone(zeus.api_para_agente(zeus._leer()))

    def test_ajustes_validan(self):
        with self.assertRaises(HTTPException):
            zeus.api_ajustes(None, {'descuento_pct': 150, 'retenciones': []})


if __name__ == '__main__':
    unittest.main()
