"""El AGENTE INVENTARIO recibe compras por la API aunque no tenga sesión del navegador: la llave vive en el panel,
así que el panel la usa para decidir si entrega trabajos (antes el agente nunca recibía nada sin credenciales en su entorno)."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import zeus


class SondeoConLlaveDelPanel(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(zeus, '_file', base / 'zeus.json'), mock.patch.object(zeus, '_secreto', base / 'secreto.json'),
                  mock.patch.object(zeus, '_pc_auth', lambda request: None)]
        for m in self.p:
            m.start()
        d = zeus._leer()
        d['items'].append({'id': 1, 'tela': 'MONTECATINI BLANCO', 'falta': 12.0, 'ordenes': [], 'bodega': [], 'estado': 'pendiente',
                           'oc': '', 'detalle': '', 'intentos': 0, 'codigo_forzado': 'A10700', 'proveedor_forzado': 'PROVEEDOR PRUEBA'})
        zeus._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_con_llave_en_el_panel_entrega_la_orden_aunque_el_agente_no_tenga_sesion(self):
        zeus._guardar_secreto({'llave': 'B' * 40, 'guardada_at': zeus._iso()})
        r = zeus.sondeo(None, {'puede_trabajar': False, 'resultados': []})
        self.assertEqual(len(r['trabajos']), 1)
        trabajo = r['trabajos'][0]
        self.assertEqual(trabajo['codigo'], 'A10700')
        self.assertEqual(trabajo['api']['llave'], 'B' * 40)

    def test_sin_llave_ni_sesion_no_entrega_nada(self):
        zeus._guardar_secreto({})
        r = zeus.sondeo(None, {'puede_trabajar': False, 'resultados': []})
        self.assertEqual(r['trabajos'], [])

    def test_con_sesion_del_navegador_sigue_entregando_sin_llave(self):
        zeus._guardar_secreto({})
        r = zeus.sondeo(None, {'puede_trabajar': True, 'resultados': []})
        self.assertEqual(len(r['trabajos']), 1)
        self.assertIsNone(r['trabajos'][0]['api'])


if __name__ == '__main__':
    unittest.main()
