import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import stockman


def _det(bodegas, nombre='MONTECATINI BLANCO', codigo='100'):
    return {codigo: [{'nombre': nombre, 'bodegas': bodegas, 'total': sum(bodegas.values())}]}


class NombresTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True)]
        for m in self.p:
            m.start()

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def refrescar(self, telas, articulo):
        with mock.patch.object(stockman.proveedores_tela, 'telas', lambda: telas), mock.patch.object(stockman.effi_api, 'articulo', articulo):
            return stockman.refrescar_nombres()

    def test_el_alias_cubre_el_nombre_con_y_sin_codigo_y_los_espacios_dobles(self):
        r = self.refrescar([{'codigo': '4100', 'nombre': 'DUAL  BLANCO', 'id_effi': ''}], lambda ref, ide='': {'id': '2707', 'descripcion': 'DUAL'})
        self.assertEqual(r['cambiadas'], 1)
        m = stockman.mapa()
        self.assertEqual(m['DUAL BLANCO'], 'DUAL')
        self.assertEqual(m['(4100) DUAL BLANCO'], '(4100) DUAL')

    def test_una_tela_que_effi_no_ve_conserva_su_ultimo_nombre(self):
        self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], lambda ref, ide='': {'id': '9', 'descripcion': 'ARTICULO A'})

        def falla(ref, ide=''):
            raise stockman.effi_api.EffiError('no hay')
        r = self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], falla)
        self.assertEqual(r['sin_articulo'], ['1'])
        self.assertEqual(stockman.mapa()['A'], 'ARTICULO A')

    def test_inventario_vacio_no_toca_nada(self):
        self.refrescar([{'codigo': '1', 'nombre': 'A', 'id_effi': ''}], lambda ref, ide='': {'id': '9', 'descripcion': 'ARTICULO A'})
        self.assertFalse(self.refrescar([], lambda ref, ide='': {})['ok'])
        self.assertEqual(stockman.mapa()['A'], 'ARTICULO A')


class AjusteTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True),
                  mock.patch.object(stockman.proveedores_tela, 'telas', lambda: [{'codigo': '100', 'nombre': 'MONTECATINI BLANCO', 'id_effi': '6082'}])]
        for m in self.p:
            m.start()
        d = stockman._leer()
        d['nombres']['100'] = {'nombre_panel': 'MONTECATINI BLANCO', 'nombre_effi': '903385 MONTECATINI DB BCO 1A', 'id_effi': '6082', 'stock_effi': {'5': 2981.0, '21': 0.41}}
        stockman._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_la_diferencia_por_bodega_deja_effi_igual_al_panel(self):
        with mock.patch.object(stockman, '_stock_panel_detalle', lambda: _det({'21': 2000.0, '23': 968.0})):
            f = stockman.evaluar()[0]
        por = {b['bodega']: b['delta'] for b in f['bodegas']}
        self.assertEqual((por['21'], por['23'], por['5']), (1999.59, 968.0, -2981.0))   # Materia Prima (5) queda en cero y las bodegas del panel igualan
        self.assertEqual(f['estado'], 'ajustar')

    def test_tela_igual_no_se_ajusta(self):
        d = stockman._leer()
        d['nombres']['100']['stock_effi'] = {'21': 2000.0, '23': 968.0}
        stockman._guardar(d)
        with mock.patch.object(stockman, '_stock_panel_detalle', lambda: _det({'21': 2000.0, '23': 968.0})):
            self.assertEqual(stockman.evaluar()[0]['estado'], 'igual')

    def test_lo_que_sobra_en_una_bodega_se_traslada_a_la_que_falta(self):
        traslados, ajustes = [], []
        with mock.patch.object(stockman, '_stock_panel_detalle', lambda: _det({'21': 2000.0})),                 mock.patch.object(stockman.effi_api, 'crear_traslado', lambda clave, o, d, art, cant, obs: traslados.append((o, d, art, cant)) or {'id': 't1'}),                 mock.patch.object(stockman.effi_api, 'crear_ajuste', lambda clave, bodega, art, delta, obs, costo=None: ajustes.append((bodega, delta)) or {'id': 'a1'}),                 mock.patch.object(stockman.effi_api, 'articulo', lambda *a: {'stock_bodegas': [{'bodega': '5', 'stock': '2981'}, {'bodega': '21', 'stock': '0.41'}]}):
            r = stockman.aplicar_tela('100', 'ADMIN')
        self.assertEqual(traslados, [(5, 21, '6082', 1999.59)])   # Materia Prima -> INDOOR: el total de Effi no cambia
        self.assertEqual(ajustes, [(5, -981.41)])               # y lo que sobra de más en Materia Prima se resta con un egreso
        h = stockman._leer()['ajustes']
        self.assertEqual([(x['operacion'], x['estado']) for x in h], [('traslado', 'hecho'), ('egreso', 'hecho')])
        self.assertEqual(r['ajustes'], 2)

    def test_lo_que_falta_en_effi_se_suma_con_un_ajuste(self):
        d = stockman._leer()
        d['nombres']['100']['stock_effi'] = {'21': 1900.0}
        stockman._guardar(d)
        ajustes = []
        with mock.patch.object(stockman, '_stock_panel_detalle', lambda: _det({'21': 2000.0})),                 mock.patch.object(stockman.effi_api, 'crear_ajuste', lambda clave, bodega, art, delta, obs, costo=None: ajustes.append((bodega, art, delta)) or {'id': 'a1'}),                 mock.patch.object(stockman.effi_api, 'articulo', lambda *a: {'stock_bodegas': [{'bodega': '21', 'stock': '1900'}]}):
            stockman.aplicar_tela('100', 'ADMIN')
        self.assertEqual(ajustes, [(21, '6082', 100.0)])


class EffiAPanelTest(unittest.TestCase):
    """Un ajuste hecho en Effi pasa al panel; el que hizo STOCKMAN no rebota; lo anterior al arranque no se trae."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.movs = []
        lista = [{'id': '10', 'articulo': '6082', 'bodega': '21', 'cantidad': '5', 'observacion': 'viejo', 'vigente': '1', 'nombre_responsable': 'X', 'fecha_trans': 'a'}]
        self.lista = lista
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True), mock.patch.object(stockman, '_stock_panel', lambda: {}),
                  mock.patch.object(stockman.proveedores_tela, 'telas', lambda: [{'codigo': '100', 'nombre': 'MONTECATINI BLANCO', 'id_effi': '6082'}]),
                  mock.patch.object(stockman.effi_api, '_lista', lambda ruta, params=None: list(self.lista)),
                  mock.patch('app.inventario_api.inventory_movement', lambda m: self.movs.append((m.type, m.mts, m.bodega, m.code)) or {'ok': True})]
        for m in self.p:
            m.start()
        d = stockman._leer()
        d['nombres']['100'] = {'nombre_panel': 'MONTECATINI BLANCO', 'nombre_effi': 'MONTECATINI', 'id_effi': '6082', 'stock_effi': {}}
        stockman._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def nuevo(self, i, cantidad, bodega='21', obs='ajuste manual'):
        self.lista.insert(0, {'id': str(i), 'articulo': '6082', 'bodega': bodega, 'cantidad': str(cantidad), 'observacion': obs, 'vigente': '1', 'nombre_responsable': 'Ana', 'fecha_trans': 'hoy'})

    def test_lo_anterior_al_arranque_no_se_trae(self):
        self.assertEqual(stockman.traer_de_effi(True), [])
        self.assertEqual(self.movs, [])

    def test_un_ajuste_nuevo_de_effi_se_registra_en_el_panel(self):
        stockman.traer_de_effi(True)
        self.nuevo(11, 40)
        self.nuevo(12, -15, bodega='23')
        stockman.traer_de_effi(True)
        self.assertEqual(self.movs, [('INGRESO', 40.0, 'BODEGA INDOOR', '100'), ('SALIDA', 15.0, '', '100')])
        stockman.traer_de_effi(True)   # no se repite
        self.assertEqual(len(self.movs), 2)

    def test_el_ajuste_de_stockman_no_rebota_y_apagado_solo_queda_pendiente(self):
        stockman.traer_de_effi(False)
        self.nuevo(11, 40, obs=stockman.PROPIO + ' (ADMIN)')
        self.nuevo(12, 7)
        stockman.traer_de_effi(False)
        self.assertEqual(self.movs, [])
        d = stockman._leer()
        self.assertEqual([p['ajuste'] for p in d['pendientes']], ['12'])
        stockman.traer_de_effi(True)
        self.assertEqual(self.movs, [('INGRESO', 7.0, 'BODEGA INDOOR', '100')])


class SoloLaBodegaQueCambioTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.panel = {'100': {'21': 2000.0, '23': 968.0}}
        self.p = [mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json'), mock.patch.object(stockman, '_usar_api', lambda: True),
                  mock.patch.object(stockman, '_stock_panel', lambda: {c: dict(v) for c, v in self.panel.items()})]
        for m in self.p:
            m.start()
        d = stockman._leer()
        d['nombres']['100'] = {'nombre_panel': 'MONTECATINI BLANCO', 'nombre_effi': 'MONTECATINI', 'id_effi': '6082', 'stock_effi': {'5': 2981.0}}
        stockman._guardar(d)

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_la_primera_vez_solo_toma_el_punto_de_partida(self):
        self.assertEqual(stockman.cambios_panel(fijar_base=True), [])
        self.assertEqual(stockman._leer()['panel_base'], {'100': {'21': 2000.0, '23': 968.0}})

    def test_solo_sale_la_bodega_que_cambio_y_por_lo_que_cambio(self):
        stockman.cambios_panel(fijar_base=True)
        self.panel['100']['23'] = 986.0   # entraron 18 mts a GLORIA; INDOOR no cambió
        c = stockman.cambios_panel()
        self.assertEqual([(x['bodega'], x['delta']) for x in c], [('23', 18.0)])
        hechos = []
        with mock.patch.object(stockman.effi_api, 'crear_ajuste', lambda clave, bodega, art, delta, obs, costo=None: hechos.append((bodega, art, delta)) or {'id': '9', 'total': None}), \
                mock.patch.object(stockman.effi_api, 'articulo', lambda *a: {'stock_bodegas': []}):
            stockman.aplicar_cambio(c[0], 'STOCKMAN')
        self.assertEqual(hechos, [(23, '6082', 18.0)])   # un solo ajuste, de una sola bodega
        self.assertEqual(stockman.cambios_panel(), [])    # ya está procesado: no se repite

    def test_una_salida_del_panel_se_resta_en_effi_solo_en_esa_bodega(self):
        stockman.cambios_panel(fijar_base=True)
        self.panel['100']['23'] = 950.0   # salieron 18 mts de GLORIA
        c = stockman.cambios_panel()
        hechos = []
        with mock.patch.object(stockman.effi_api, 'crear_ajuste', lambda clave, bodega, art, delta, obs, costo=None: hechos.append((bodega, art, delta)) or {'id': '9', 'total': None}),                 mock.patch.object(stockman.effi_api, 'articulo', lambda *a: {'stock_bodegas': []}):
            stockman.aplicar_cambio(c[0], 'STOCKMAN')
        self.assertEqual(hechos, [(23, '6082', -18.0)])

    def test_lo_que_trae_effi_no_se_devuelve_a_effi(self):
        stockman.cambios_panel(fijar_base=True)
        self.panel['100']['21'] = 2040.0   # el panel cambió porque STOCKMAN trajo un ajuste de Effi
        stockman._base_a_actual(['100'])
        self.assertEqual(stockman.cambios_panel(), [])


class _Peticion:
    headers = {'content-type': 'application/json'}

    async def body(self):
        return b'{}'


class MismoCodigoTest(unittest.TestCase):
    """Varias telas del panel con el mismo código: se escoge por código Y por nombre, y si no se distingue no se toca."""
    LONDON = {'nombre': 'LONDON BLANCO', 'bodegas': {'21': 2486.0}, 'total': 2486.0}
    MILANO = {'nombre': 'MILANO BLANCO (DUNGA)', 'bodegas': {'21': 11.0}, 'total': 11.0}

    def test_escoge_la_que_se_parece_al_nombre_del_articulo_de_effi(self):
        elegido, _ = stockman._elegir('500', [self.MILANO, self.LONDON], '901504 LONDON BCO 1A')
        self.assertEqual(elegido['nombre'], 'LONDON BLANCO')   # 2.486 mts, no los 11 de la otra tela
        e, _ = stockman._elegir('4302', [{'nombre': 'SUPER ZENTRAL AZUL OSCURO', 'bodegas': {}, 'total': 496}, {'nombre': 'SUPER ZENTRAL NEGRO', 'bodegas': {}, 'total': 426}], 'SUPER ZENTRAL NEGRO')
        self.assertEqual(e['nombre'], 'SUPER ZENTRAL NEGRO')

    def test_si_no_se_distingue_no_se_toca(self):
        a = {'nombre': 'EXIRRIB BLANCO', 'bodegas': {}, 'total': 8}
        b = {'nombre': 'SUPERRIB BLANCO', 'bodegas': {}, 'total': 41}
        self.assertIsNone(stockman._elegir('8100', [a, b], 'SUPERRIB (EXIRRIB)')[0])

    def test_lo_que_decide_una_persona_manda(self):
        a = {'nombre': 'EXIRRIB BLANCO', 'bodegas': {'21': 8.0}, 'total': 8.0}
        b = {'nombre': 'SUPERRIB BLANCO', 'bodegas': {'21': 41.0, '23': 3.0}, 'total': 44.0}
        suma, _ = stockman._elegir('8100', [a, b], 'SUPERRIB (EXIRRIB)', {'modo': 'suma'})
        self.assertEqual((suma['total'], suma['bodegas']), (52.0, {'21': 49.0, '23': 3.0}))
        una, _ = stockman._elegir('8100', [a, b], 'SUPERRIB (EXIRRIB)', {'modo': 'una', 'nombre': 'EXIRRIB BLANCO'})
        self.assertEqual(una['nombre'], 'EXIRRIB BLANCO')

    def test_un_solo_registro_con_ese_codigo_es_ese(self):
        self.assertEqual(stockman._elegir('100', [self.LONDON], 'LO QUE SEA')[0]['nombre'], 'LONDON BLANCO')


class SinIdNoEsAutomaticoTest(unittest.TestCase):
    def test_solo_las_telas_con_id_de_effi_entran_en_lo_automatico(self):
        with tempfile.TemporaryDirectory() as dir_:
            with mock.patch.object(stockman, '_file', Path(dir_) / 's.json'),                     mock.patch.object(stockman, '_stock_panel_detalle', lambda: {'100': _det({'21': 5.0})['100'], '200': _det({'21': 9.0}, 'OTRA', '200')['200']}):
                d = stockman._leer()
                d['nombres']['100'] = {'nombre_effi': 'MONTECATINI', 'id_effi': '6082'}   # tiene artículo en Effi
                stockman._guardar(d)                                                       # la 200 no tiene ID: queda fuera
                self.assertEqual(stockman._stock_panel(), {'100': {'21': 5.0}})


class WebhookTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(stockman, '_file', Path(self.dir.name) / 's.json')
        self.p.start()
        stockman._despertar.clear()

    def tearDown(self):
        self.p.stop()
        self.dir.cleanup()

    def test_con_la_clave_correcta_despierta_a_stockman_y_con_otra_da_404(self):
        import asyncio
        from fastapi import HTTPException
        clave = stockman._clave_webhook()
        with self.assertRaises(HTTPException) as r:
            asyncio.run(stockman.webhook('clave-mala', _Peticion()))
        self.assertEqual(r.exception.status_code, 404)
        self.assertFalse(stockman._despertar.is_set())
        self.assertEqual(asyncio.run(stockman.webhook(clave, _Peticion())), {'ok': True})
        self.assertTrue(stockman._despertar.is_set())
        w = stockman._leer()['webhook']
        self.assertEqual(w['recibidos'], 1)
        self.assertEqual(stockman._clave_webhook(), clave)   # la clave no cambia


class FirmaTest(unittest.TestCase):
    def test_firma_hmac_sha256_valida_o_no(self):
        import hashlib
        import hmac
        cuerpo = b'{"x":1}'
        f = hmac.new(b'secreto', cuerpo, hashlib.sha256).hexdigest()
        self.assertEqual(stockman._verificar_firma('secreto', cuerpo, {'x-signature': 'sha256=' + f}), 'valida')
        self.assertEqual(stockman._verificar_firma('secreto', cuerpo, {'x-signature': 'otra'}), 'no_coincide')
        self.assertEqual(stockman._verificar_firma('secreto', cuerpo, {'content-type': 'x'}), 'sin_firma')
        self.assertEqual(stockman._verificar_firma('', cuerpo, {'x-signature': f}), 'sin_secreto')


if __name__ == '__main__':
    unittest.main()
