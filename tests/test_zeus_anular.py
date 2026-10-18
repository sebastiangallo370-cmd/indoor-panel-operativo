"""Anular desde la tarjeta: la orden se anula en Effi por la API y queda anulada en el panel; la tela vuelve a contar como faltante."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import effi_api, zeus


class Anular(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(zeus, '_file', base / 'zeus.json'), mock.patch.object(zeus, '_secreto', base / 'secreto.json'),
                  mock.patch.object(zeus, '_auth', lambda request: 'Indoor Sport'), mock.patch.object(zeus, '_permitido', lambda u: True)]
        for m in self.p:
            m.start()
        d = zeus._leer()
        d['items'].append({'id': 7, 'tela': 'MONTECATINI BLANCO', 'falta': 10.0, 'ordenes': [], 'bodega': [], 'estado': 'creada', 'oc': '136', 'detalle': '', 'intentos': 0})
        d['pedido_por_tela']['MONTECATINI BLANCO'] = 25.0
        zeus._guardar(d)
        zeus._guardar_secreto({'llave': 'B' * 40, 'guardada_at': zeus._iso()})

    def tearDown(self):
        effi_api.usar_llave('')
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def item(self):
        return next(i for i in zeus._leer()['items'] if i['id'] == 7)

    def test_anula_y_la_tela_vuelve_a_faltar(self):
        with mock.patch.object(effi_api, '_peticion', return_value={'ok': True, 'data': {'id': '136', 'vigente': '0'}}) as llamada:
            r = zeus.anular_orden(None, {'id': 7, 'motivo': 'prueba'})
        self.assertTrue(r['ok'])
        args, kwargs = llamada.call_args
        self.assertEqual(args[:2], ('DELETE', 'orden_c'))
        self.assertEqual(kwargs['cuerpo'], {'sucursal': 1, 'id': 136, 'observacion_anular': 'prueba'})
        self.assertEqual(self.item()['estado'], 'anulada')
        self.assertEqual(zeus._leer()['pedido_por_tela']['MONTECATINI BLANCO'], 15.0)

    def test_si_effi_dice_que_ya_estaba_anulada_se_refleja(self):
        with mock.patch.object(effi_api, '_peticion', side_effect=effi_api.EffiError('La orden de compra PPAL-136 ya se encuentra anulada.', 400)):
            r = zeus.anular_orden(None, {'id': 7})
        self.assertTrue(r['ya_anulada'])
        self.assertEqual(self.item()['estado'], 'anulada')

    def test_otro_error_de_effi_no_cambia_nada(self):
        with mock.patch.object(effi_api, '_peticion', side_effect=effi_api.EffiError('Tiene documentos asociados vigentes', 400)):
            with self.assertRaises(HTTPException) as e:
                zeus.anular_orden(None, {'id': 7})
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(self.item()['estado'], 'creada')

    def test_sin_api_key_no_anula(self):
        zeus._guardar_secreto({})
        with self.assertRaises(HTTPException) as e:
            zeus.anular_orden(None, {'id': 7})
        self.assertIn('API de Effi', e.exception.detail)

    def test_solo_las_creadas(self):
        d = zeus._leer()
        d['items'][0]['estado'] = 'anulada'
        zeus._guardar(d)
        with self.assertRaises(HTTPException) as e:
            zeus.anular_orden(None, {'id': 7})
        self.assertEqual(e.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
