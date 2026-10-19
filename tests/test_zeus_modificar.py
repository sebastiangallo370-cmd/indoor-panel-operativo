"""Modificar desde la tarjeta: se anula la orden en Effi y el agente crea una nueva con el proveedor, la referencia y/o la cantidad elegidos."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import effi_api, proveedores_tela, zeus


class Modificar(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(zeus, '_file', base / 'zeus.json'), mock.patch.object(zeus, '_secreto', base / 'secreto.json'),
                  mock.patch.object(zeus, '_auth', lambda request: 'Indoor Sport'), mock.patch.object(zeus, '_permitido', lambda u: True),
                  mock.patch.object(proveedores_tela, 'telas', lambda: [{'codigo': '700', 'nombre': 'TOUR'}, {'codigo': '100', 'nombre': 'MONTECATINI'}]),
                  mock.patch.object(proveedores_tela, 'proveedor_de', lambda c: {})]
        for m in self.p:
            m.start()
        d = zeus._leer()
        d['items'].append({'id': 7, 'tela': 'MONTECATINI BLANCO', 'falta': 10.0, 'ordenes': [{'orden': 'RM1'}], 'bodega': ['(100) MONTECATINI BLANCO'], 'estado': 'creada', 'oc': '138', 'detalle': '', 'intentos': 0,
                           'proveedor_usado': 'LINDATEXTIL'})
        d['pedido_por_tela']['MONTECATINI BLANCO'] = 10.0
        zeus._guardar(d)
        zeus._guardar_secreto({'llave': 'B' * 40, 'guardada_at': zeus._iso()})

    def tearDown(self):
        effi_api.usar_llave('')
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def items(self):
        return {i['id']: i for i in zeus._leer()['items']}

    def llamar(self, payload, **efectos):
        with mock.patch.object(effi_api, 'articulo', **efectos.get('articulo', {'return_value': {}})), \
             mock.patch.object(effi_api, 'proveedor', **efectos.get('proveedor', {'return_value': {}})), \
             mock.patch.object(effi_api, '_peticion', **efectos.get('peticion', {'return_value': {'ok': True, 'data': {}}})) as peticion:
            r = zeus.modificar_orden(None, payload)
        return r, peticion

    def test_cambia_la_cantidad_anula_y_deja_la_nueva_en_cola(self):
        r, peticion = self.llamar({'id': 7, 'cambiar': ['cantidad'], 'cantidad': '25,5'})
        self.assertTrue(r['ok'])
        self.assertEqual(peticion.call_args[0][:2], ('DELETE', 'orden_c'))
        it = self.items()
        self.assertEqual(it[7]['estado'], 'anulada')
        nuevo = it[r['nuevo_id']]
        self.assertEqual((nuevo['estado'], nuevo['falta'], nuevo['manual']), ('pendiente', 25.5, True))
        self.assertEqual((nuevo['codigo_forzado'], nuevo['proveedor_forzado']), ('100', 'LINDATEXTIL'))
        self.assertEqual(zeus._leer()['pedido_por_tela']['MONTECATINI BLANCO'], 0.0)

    def test_cambia_proveedor_y_referencia(self):
        r, _ = self.llamar({'id': 7, 'cambiar': ['proveedor', 'referencia'], 'proveedor': 'OTRO TEXTIL', 'codigo': '700'})
        nuevo = self.items()[r['nuevo_id']]
        self.assertEqual((nuevo['codigo_forzado'], nuevo['proveedor_forzado'], nuevo['tela'], nuevo['falta']), ('700', 'OTRO TEXTIL', 'TOUR', 10.0))
        self.assertEqual(nuevo['bodega'], [])

    def test_si_la_referencia_no_existe_no_se_anula_nada(self):
        with self.assertRaises(HTTPException) as e:
            self.llamar({'id': 7, 'cambiar': ['referencia'], 'codigo': '999'}, articulo={'side_effect': effi_api.EffiError('No hay en Effi un artículo con Referencia exacta 999', 400)})
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(self.items()[7]['estado'], 'creada')
        self.assertEqual(len(self.items()), 1)

    def test_si_effi_no_anula_no_se_crea_la_nueva(self):
        with self.assertRaises(HTTPException):
            self.llamar({'id': 7, 'cambiar': ['cantidad'], 'cantidad': 5}, peticion={'side_effect': effi_api.EffiError('Tiene documentos asociados vigentes', 400)})
        self.assertEqual(len(self.items()), 1)
        self.assertEqual(self.items()[7]['estado'], 'creada')

    def test_validaciones(self):
        for p in ({'id': 7, 'cambiar': []}, {'id': 7, 'cambiar': ['cantidad'], 'cantidad': 'abc'}, {'id': 7, 'cambiar': ['cantidad'], 'cantidad': 0}, {'id': 7, 'cambiar': ['proveedor'], 'proveedor': ''}):
            with self.assertRaises(HTTPException) as e:
                self.llamar(p)
            self.assertEqual(e.exception.status_code, 400)

    def test_solo_las_creadas(self):
        d = zeus._leer()
        d['items'][0]['estado'] = 'anulada'
        zeus._guardar(d)
        with self.assertRaises(HTTPException) as e:
            self.llamar({'id': 7, 'cambiar': ['cantidad'], 'cantidad': 5})
        self.assertEqual(e.exception.status_code, 404)

    def test_la_sincronizacion_no_cancela_la_orden_modificada(self):
        r, _ = self.llamar({'id': 7, 'cambiar': ['cantidad'], 'cantidad': 12})
        zeus.configurar(lambda: [], lambda request: None)   # sin faltantes: normalmente cancelaría lo pendiente
        zeus.sincronizar()
        self.assertEqual(self.items()[r['nuevo_id']]['estado'], 'pendiente')


if __name__ == '__main__':
    unittest.main()
