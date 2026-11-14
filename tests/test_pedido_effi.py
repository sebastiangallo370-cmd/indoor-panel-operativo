"""PEDIDO EN EFFI: cuerpo de la cotización/remisión, totales, formas de pago, apagado por defecto y permisos. Effi va simulado: no se crea nada."""
import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import effi_api
from app import pedido_effi as pe

FORMAS = [{'id': 1, 'nombre': 'Contado', 'credito': False, 'defecto': False},
          {'id': 2, 'nombre': 'Contado a 1 día', 'credito': True, 'defecto': True},
          {'id': 6, 'nombre': '30 días', 'credito': True, 'defecto': False}]
RETENCIONES = [{'id': 66, 'nombre': 'RETEICA 11.6 X MIL (1.16%)', 'valor': '1.160', 'tipo': 'Sobre base', 'base': '0.00', 'base_excluida': '0.00', 'base_maxima': '0.00'},
               {'id': 28, 'nombre': 'Retefuente 1% compras', 'valor': '1', 'tipo': 'Sobre base', 'base': '0.00', 'base_excluida': '0.00', 'base_maxima': '0.00'},
               {'id': 70, 'nombre': 'ReteFuente 4%', 'valor': '4', 'tipo': 'Sobre base', 'base': '1000000', 'base_excluida': '0.00', 'base_maxima': '0.00'},
               {'id': 71, 'nombre': 'ReteIVA 15%', 'valor': '15', 'tipo': 'Sobre impuesto principal', 'base': '0.00', 'base_excluida': '0.00', 'base_maxima': '0.00'},
               {'id': 72, 'nombre': 'Con tope', 'valor': '2', 'tipo': 'Sobre base', 'base': '0.00', 'base_excluida': '0.00', 'base_maxima': '5000000'}]
CATALOGO = {'formas_pago': FORMAS, 'sucursales': [], 'bodegas': [], 'centros': [], 'vendedores': [], 'monedas': [], 'retenciones': RETENCIONES}
IVA = {'id': 7, 'etiqueta': 'IVA 19%', 'tipo_calculo': 'Porcentaje', 'valor': '19'}


def articulo(_ref, ide=''):
    return {'id': ide, 'referencia': f'REF{ide}', 'descripcion': f'ARTICULO {ide}', 'impuesto': 'IVA 19%' if ide == '10' else ''}


def base(**extra):
    p = {'tipo': 'cotizacion', 'clave': 'pedido-abc12345', 'sucursal': 1, 'bodega': 1, 'centro_costos': 4, 'fecha_entrega': '2026-11-20', 'cliente': 3343,
         'conceptos': [{'articulo': 11, 'cantidad': 10, 'precio': 70000, 'descuento': 0}], 'formas_pago': [{'id': 2}]}
    p.update(extra)
    return p


class Construir(unittest.TestCase):
    def setUp(self):
        for objetivo, nuevo in (('articulo', articulo), ('impuestos_de', lambda t: [IVA] if t else [])):
            m = mock.patch.object(effi_api, objetivo, nuevo)
            m.start(); self.addCleanup(m.stop)
        m = mock.patch.object(pe, '_catalogos', lambda: CATALOGO)
        m.start(); self.addCleanup(m.stop)

    def test_sin_impuesto_la_forma_de_pago_toma_el_total(self):
        r = pe.construir(base(), 'Ana')
        c = r['cuerpo']
        self.assertEqual((c['articulo'], c['cantidad'], c['precio'], c['valor_forma_pago']), (['11'], [10.0], [70000.0], [700000.0]))
        self.assertEqual((c['divisa'], c['trm'], c['t_forma_pago']), ('COP', 1, [2]))
        self.assertNotIn('impuestos', c)
        self.assertIn('Ana', c['observacion'])

    def test_iva_y_descuento_por_concepto(self):
        p = base(conceptos=[{'articulo': 10, 'cantidad': 2, 'precio': 100000, 'descuento': 20000}])
        r = pe.construir(p)
        self.assertEqual(r['cuerpo']['impuestos'], {'1': [7]})
        self.assertEqual(r['resumen']['total'], 214200.0)   # (200.000 - 20.000) × 1,19
        self.assertEqual(r['cuerpo']['valor_forma_pago'], [214200.0])

    def test_sin_iva_quita_el_impuesto_solo_de_ese_concepto(self):
        p = base(conceptos=[{'articulo': 10, 'cantidad': 2, 'precio': 100000, 'descuento': 20000, 'sin_iva': True},
                            {'articulo': 10, 'cantidad': 1, 'precio': 100000, 'descuento': 0}])
        r = pe.construir(p)
        self.assertEqual(r['cuerpo']['impuestos'], {'2': [7]})   # solo el segundo concepto lleva IVA
        self.assertEqual(r['resumen']['total'], 180000.0 + 119000.0)

    def test_dos_formas_de_pago_la_vacia_toma_el_resto(self):
        r = pe.construir(base(formas_pago=[{'id': 2, 'valor': 350000}, {'id': 6, 'valor': ''}]))
        self.assertEqual(r['cuerpo']['valor_forma_pago'], [350000.0, 350000.0])

    def test_formas_que_no_suman_el_total(self):
        with self.assertRaises(HTTPException) as e:
            pe.construir(base(formas_pago=[{'id': 2, 'valor': 100000}, {'id': 6, 'valor': 100000}]))
        self.assertEqual(e.exception.status_code, 400)

    def test_remision_no_acepta_contado_que_pide_caja(self):
        with self.assertRaises(HTTPException) as e:
            pe.construir(base(tipo='remision', formas_pago=[{'id': 1}]))
        self.assertIn('Contado a 1 día', e.exception.detail)
        pe.construir(base(tipo='remision', formas_pago=[{'id': 6}]))   # a crédito sí

    def test_descuento_mayor_que_el_valor(self):
        with self.assertRaises(HTTPException):
            pe.construir(base(conceptos=[{'articulo': 11, 'cantidad': 1, 'precio': 1000, 'descuento': 5000}]))

    def test_faltantes_se_explican(self):
        for campo in ('sucursal', 'bodega', 'centro_costos', 'cliente'):
            p = base(); p[campo] = ''
            with self.assertRaises(HTTPException) as e:
                pe.construir(p)
            self.assertEqual(e.exception.status_code, 400)
        with self.assertRaises(HTTPException):
            pe.construir(base(conceptos=[]))
        with self.assertRaises(HTTPException):
            pe.construir(base(fecha_entrega=''))
        with self.assertRaises(HTTPException):
            pe.construir(base(clave='x'))
        with self.assertRaises(HTTPException):
            pe.construir(base(tipo='factura'))

    def test_direccion_y_vendedor_solo_si_vienen_completos(self):
        d = {'id_pais': 47, 'id_provincia': 776, 'id_ciudad': 12601, 'direccion': 'CL 32 C CR 65 C 17', 'referencia': ''}
        c = pe.construir(base(direccion=d, vendedor=112))['cuerpo']
        self.assertEqual((c['id_ciudad_cliente'], c['vendedor']), (12601, 112))
        self.assertNotIn('referencia_cliente', c)
        c2 = pe.construir(base(direccion={'id_pais': 47}))['cuerpo']
        self.assertNotIn('direccion_cliente', c2)

    def test_la_observacion_respeta_el_limite_de_la_remision(self):
        c = pe.construir(base(tipo='remision', formas_pago=[{'id': 6}], observacion='x' * 400))['cuerpo']
        self.assertLessEqual(len(c['observacion']), 255)


class Funciones(unittest.TestCase):
    """Los espacios de «Crear cotización» de Effi que tiene el formulario: moneda/TRM, descuento global, obsequio, observación por concepto, retenciones, propina y pronto pago."""
    def setUp(self):
        for objetivo, nuevo in (('articulo', articulo), ('impuestos_de', lambda t: [IVA] if t else [])):
            m = mock.patch.object(effi_api, objetivo, nuevo)
            m.start(); self.addCleanup(m.stop)
        m = mock.patch.object(pe, '_catalogos', lambda: CATALOGO)
        m.start(); self.addCleanup(m.stop)

    def test_moneda_extranjera_pide_trm_y_cop_la_fuerza_a_uno(self):
        with self.assertRaises(HTTPException):
            pe.construir(base(divisa='USD'))
        c = pe.construir(base(divisa='USD', trm='4000'))['cuerpo']
        self.assertEqual((c['divisa'], c['trm']), ('USD', 4000.0))
        c = pe.construir(base(divisa='COP', trm='9999'))['cuerpo']
        self.assertEqual((c['divisa'], c['trm']), ('COP', 1.0))
        with self.assertRaises(HTTPException):
            pe.construir(base(divisa='PESOS'))

    def test_descuento_global_se_manda_y_no_pasa_de_100(self):
        c = pe.construir(base(descuento_global=10, conceptos=[{'articulo': 11, 'cantidad': 10, 'precio': 70000, 'descuento': 70000}]))
        self.assertEqual(c['cuerpo']['descuento_global'], 10.0)
        self.assertEqual(c['resumen']['total'], 630000.0)
        with self.assertRaises(HTTPException):
            pe.construir(base(descuento_global=101))
        self.assertNotIn('descuento_global', pe.construir(base())['cuerpo'])

    def test_obsequio_descuenta_el_cien_por_ciento_y_manda_gift(self):
        c = pe.construir(base(conceptos=[{'articulo': 10, 'cantidad': 2, 'precio': 100000, 'obsequio': True, 'observacion': 'cortesía del club'},
                                         {'articulo': 11, 'cantidad': 1, 'precio': 50000}]))
        self.assertEqual(c['cuerpo']['gift'], [1, 0])
        self.assertEqual(c['cuerpo']['observacion_concepto'], ['cortesía del club', ''])
        self.assertEqual(c['cuerpo']['descuento'], [0.0, 0.0])
        self.assertEqual((c['resumen']['descuento'], c['resumen']['impuestos'], c['resumen']['total']), (200000.0, 38000.0, 88000.0))   # el obsequio SÍ paga IVA (sobre el valor completo): su línea son solo los impuestos

    def test_retenciones_se_calculan_y_las_formas_de_pago_suman_el_total_neto(self):
        p = base(conceptos=[{'articulo': 10, 'cantidad': 10, 'precio': 100000}], retenciones=[66, 70, 71])
        r = pe.construir(p)
        self.assertEqual(r['cuerpo']['retencion'], [66, 70, 71])
        res = r['resumen']
        self.assertEqual(res['impuestos'], 190000.0)                               # 1.000.000 + IVA 190.000
        self.assertEqual([x['valor'] for x in res['retenciones_detalle']], [11600.0, 40000.0, 28500.0])   # ICA 1,16 % · 4 % (supera la base) · 15 % del IVA
        self.assertEqual((res['retenciones'], res['total']), (80100.0, 1109900.0))   # total neto = 1.190.000 − 80.100
        self.assertEqual(r['cuerpo']['valor_forma_pago'], [1109900.0])

    def test_numeros_que_mostro_effi_en_su_pantalla(self):
        """Prueba hecha por el usuario en «Crear cotización» de Effi (artículo de $71.000, retención 1 %, propina 10 %, sin guardar)."""
        r = pe.construir(base(conceptos=[{'articulo': 10, 'cantidad': 1, 'precio': 71000}], retenciones=[28], propina=7100))['resumen']
        self.assertEqual((r['subtotal'], r['impuestos'], r['propina'], r['retenciones'], r['total']), (71000.0, 13490.0, 7100.0, 710.0, 90880.0))
        r = pe.construir(base(conceptos=[{'articulo': 11, 'cantidad': 1, 'precio': 71000, 'descuento': 7100}], retenciones=[28]))['resumen']
        self.assertEqual((r['subtotal'], r['retenciones'], r['total']), (63900.0, 639.0, 63261.0))   # descuento global 10 %: $7.100 por línea
        o = pe.construir(base(conceptos=[{'articulo': 10, 'cantidad': 1, 'precio': 71000, 'obsequio': True}], retenciones=[28], propina=0))['resumen']
        self.assertEqual((o['subtotal'], o['retenciones'], o['impuestos'], o['total']), (0.0, 0.0, 13490.0, 13490.0))   # obsequio: subtotal, retención y propina en cero; el IVA sí se paga

    def test_retencion_bajo_la_base_minima_no_aplica_y_las_raras_se_rechazan(self):
        r = pe.construir(base(retenciones=[70]))          # subtotal 700.000 < base 1.000.000
        self.assertEqual(r['resumen']['retenciones'], 0.0)
        with self.assertRaises(HTTPException):
            pe.construir(base(retenciones=[72]))          # base máxima: no sabe calcularla
        with self.assertRaises(HTTPException):
            pe.construir(base(retenciones=[999]))         # no existe

    def test_propina_se_suma_al_total(self):
        r = pe.construir(base(propina=50000))
        self.assertEqual((r['cuerpo']['propina'], r['resumen']['total'], r['cuerpo']['valor_forma_pago']), (50000.0, 750000.0, [750000.0]))
        self.assertNotIn('propina', pe.construir(base())['cuerpo'])

    def test_pronto_pago_pide_fecha_y_no_cambia_el_total(self):
        with self.assertRaises(HTTPException):
            pe.construir(base(prontopago=20000))
        r = pe.construir(base(prontopago=20000, fecha_prontopago='2026-12-01'))
        self.assertEqual((r['cuerpo']['prontopago'], r['cuerpo']['fecha_prontopago'], r['resumen']['total']), (20000.0, '2026-12-01', 700000.0))


ART_3460 = {'id': '3460', 'referencia': 'A1000CPDVS-S', 'descripcion': 'CAMISETA TIPO POLO COLEGIO DIVINO SALVADOR', 'gtin': None, 'codigos_barras': '24202418', 'ventas': '1',
            'precios_venta': 'Tarifa normal: 71000.0000; Tarifa especial empleados: 0.0000; Tarifa Mayorista: 0.0000', 'impuesto': None}
ART_GTIN = {'id': '55', 'referencia': 'BAL-01', 'descripcion': 'BALON', 'gtin': '7701234567890', 'ventas': '1', 'precios_venta': 'Tarifa normal: 0.0000; Tarifa Mayorista: 30000.0000', 'impuesto': 'IVA 19%'}
ART_SERIE = {'id': '77', 'referencia': 'CEL-1', 'descripcion': 'CELULAR', 'ventas': '1', 'precios_venta': 'Tarifa normal: 900000.0000', 'impuesto': None}


def lista_falsa(ruta, params=None):
    """Effi simulado: busca por gtin, c_barras, id y por código de serie."""
    p = params or {}
    if ruta == 'articulo':
        if p.get('gtin') == '7701234567890':
            return [ART_GTIN]
        if p.get('c_barras') == '24202418':
            return [ART_3460]
        if p.get('id') == '3460':
            return [ART_3460]
        if p.get('id') == '77':
            return [ART_SERIE]
        return []
    if ruta == 'serie':
        return {'IMEI111': [{'id': '9001', 'codigo': 'IMEI111', 'articulo': '77'}], 'IMEI222': [{'id': '9002', 'codigo': 'IMEI222', 'articulo': '77'}]}.get(p.get('codigo'), [])
    return []


class CapturarSeries(unittest.TestCase):
    """Capturar series (F8): cada código agrega un concepto de cantidad 1 (serie, ID de artículo, GTIN/EPC u otro código de barras)."""
    def setUp(self):
        m = mock.patch.object(effi_api, '_lista', lista_falsa)
        m.start(); self.addCleanup(m.stop)

    def test_precio_de_lista_sale_de_la_tarifa_normal(self):
        self.assertEqual(pe._precio_de(ART_3460), 71000.0)
        self.assertEqual(pe._precio_de(ART_GTIN), 30000.0)          # sin tarifa normal: toma el primer precio mayor que cero
        self.assertEqual(pe._precio_de({'precios_venta': ''}), 0.0)

    def test_cada_tipo_de_codigo_encuentra_su_articulo(self):
        r = pe.capturar_codigos('7701234567890 24202418 3460 IMEI111')
        self.assertEqual([(c['id'], c['id_serie'], c['cantidad']) for c in r['conceptos']], [(55, None, 1), (3460, None, 2), (77, 9001, 1)])   # 24202418 y 3460 son el mismo artículo: suma
        self.assertEqual((r['no_encontrados'], r['repetidos']), ([], []))
        self.assertEqual(r['conceptos'][1]['precio'], 71000.0)
        self.assertEqual(r['conceptos'][0]['impuesto'], 'IVA 19%')

    def test_separadores_como_en_effi(self):
        r = pe.capturar_codigos('7701234567890,24202418;IMEI111\n\tIMEI222.3460')
        self.assertEqual([c['id'] for c in r['conceptos']], [55, 3460, 77, 77, 3460][:0] or [55, 3460, 77, 77])   # 3460 repetido suma a su concepto
        self.assertEqual([c['id_serie'] for c in r['conceptos']], [None, None, 9001, 9002])
        self.assertEqual(r['conceptos'][1]['cantidad'], 2)

    def test_serie_repetida_y_codigo_desconocido_se_avisan(self):
        r = pe.capturar_codigos('IMEI111 IMEI111 XYZ999 XYZ999')
        self.assertEqual(len(r['conceptos']), 1)
        self.assertEqual((r['repetidos'], r['no_encontrados']), (['IMEI111'], ['XYZ999']))

    def test_vacio_y_demasiados_codigos(self):
        with self.assertRaises(HTTPException):
            pe.capturar_codigos('  ,; ')
        with self.assertRaises(HTTPException):
            pe.capturar_codigos(' '.join(f'C{i}' for i in range(pe.MAX_CODIGOS + 1)))

    def test_una_serie_va_en_el_cuerpo_con_cantidad_uno_y_null_en_los_demas(self):
        for objetivo, nuevo in (('articulo', articulo), ('impuestos_de', lambda t: [])):
            m = mock.patch.object(effi_api, objetivo, nuevo)
            m.start(); self.addCleanup(m.stop)
        m = mock.patch.object(pe, '_catalogos', lambda: CATALOGO)
        m.start(); self.addCleanup(m.stop)
        r = pe.construir(base(conceptos=[{'articulo': 11, 'cantidad': 2, 'precio': 1000}, {'articulo': 77, 'cantidad': 1, 'precio': 900000, 'id_serie': 9001}]))
        self.assertEqual(r['cuerpo']['id_serie'], [None, 9001])
        with self.assertRaises(HTTPException):
            pe.construir(base(conceptos=[{'articulo': 77, 'cantidad': 2, 'precio': 1, 'id_serie': 9001}]))
        with self.assertRaises(HTTPException):
            pe.construir(base(conceptos=[{'articulo': 77, 'cantidad': 1, 'precio': 1, 'id_serie': 9001}, {'articulo': 77, 'cantidad': 1, 'precio': 1, 'id_serie': 9001}]))
        self.assertNotIn('id_serie', pe.construir(base())['cuerpo'])


class Crear(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        m = mock.patch.object(pe, 'APAGADO_ARCHIVO', Path(self.tmp.name) / 'apagado')
        m.start(); self.addCleanup(m.stop)
        m = mock.patch.dict(os.environ, {'PEDIDO_EFFI_ACTIVO': ''})
        m.start(); self.addCleanup(m.stop)
        pe.configurar(lambda r: 'Ana', lambda u: u == 'Ana', lambda: 'llave', lambda u: u == 'Ana')

    def _con_effi_simulado(self):
        for objetivo, nuevo in (('articulo', articulo), ('impuestos_de', lambda t: [])):
            m = mock.patch.object(effi_api, objetivo, nuevo)
            m.start(); self.addCleanup(m.stop)
        m = mock.patch.object(pe, '_catalogos', lambda: CATALOGO)
        m.start(); self.addCleanup(m.stop)

    def test_siempre_activo_y_solo_el_freno_de_emergencia_del_servidor_lo_detiene(self):
        self._con_effi_simulado()
        self.assertTrue(pe.activo())
        self.assertTrue(pe.estado(object())['activo'])
        pe.APAGADO_ARCHIVO.write_text('frenado', encoding='utf-8')   # freno de emergencia (archivo en el servidor)
        self.assertFalse(pe.activo())
        with mock.patch.object(effi_api, 'crear_cotizacion') as c:
            with self.assertRaises(HTTPException) as e:
                pe.crear(object(), base())
            self.assertEqual(e.exception.status_code, 409)
            c.assert_not_called()
        pe.APAGADO_ARCHIVO.unlink()
        self.assertTrue(pe.activo())
        with mock.patch.dict(os.environ, {'PEDIDO_EFFI_ACTIVO': '0'}):   # o por variable de entorno
            self.assertFalse(pe.activo())

    def test_ya_no_hay_interruptor_en_pantalla_ni_ruta_para_cambiarlo(self):
        self.assertFalse(hasattr(pe, 'cambiar_activo'))
        self.assertNotIn('puede_activar', pe.estado(object()))

    def test_crea_la_cotizacion_y_la_remision(self):
        self._con_effi_simulado()
        with mock.patch.object(effi_api, 'crear_cotizacion', return_value={'id': '6400', 'prefijo': 'CO', 'total': 700000}) as c, \
                mock.patch.object(effi_api, 'crear_remision', return_value={'id': '88', 'prefijo': 'RV', 'total': 700000}) as r:
            a = pe.crear(object(), base())
            self.assertEqual((a['numero'], a['tipo']), ('CO6400', 'cotización'))
            b = pe.crear(object(), base(tipo='remision', formas_pago=[{'id': 6}]))
            self.assertEqual(b['numero'], 'RV88')
            self.assertEqual((c.call_count, r.call_count), (1, 1))

    def test_permisos(self):
        pe.configurar(lambda r: 'Otro', lambda u: False, lambda: 'llave', lambda u: False)
        for f in (lambda: pe.estado(object()), lambda: pe.crear(object(), base())):
            with self.assertRaises(HTTPException) as e:
                f()
            self.assertEqual(e.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()


class BuscarArticulos(unittest.TestCase):
    """Una búsqueda extra que falle en Effi nunca debe tumbar los resultados que ya aparecieron (pasó con el buscador del celular)."""
    def test_si_falla_la_busqueda_por_descripcion_igual_salen_los_de_referencia(self):
        def lista(recurso, filtros):
            if 'referencia' in filtros and filtros['referencia'].endswith('%') and not filtros['referencia'].startswith('%'):
                return [{'id': 1, 'referencia': 'A200FUT01', 'descripcion': 'UNIFORME FUTBOL', 'ventas': '1'}]
            raise HTTPException(502, 'Effi no respondió')
        with mock.patch.object(pe, '_usuario', lambda r: 'x'), mock.patch.object(pe, '_con_llave', lambda: None), \
                mock.patch.object(pe, '_effi', lambda f, *a: f(*a)), mock.patch.object(effi_api, '_lista', lista):
            r = pe.articulos(mock.Mock(), 'A200FUT0')
        self.assertEqual([a['referencia'] for a in r['articulos']], ['A200FUT01'])


class ProyectosDelCliente(unittest.TestCase):
    CARPETAS = ['CORPORACION SOCIOCULTURAL CERROS FC', 'NICOLAS ANTONIO RAVE', 'ATLETICO NACIONAL']

    def test_el_nombre_de_effi_encuentra_su_carpeta_aunque_no_sea_identico(self):
        n = 'CORPORACION SOCIOCULTURAL CERROS FUTBOL CLUB DE MEDELLIN S.A.S. EN LIQUIDACION'
        self.assertEqual(pe.carpeta_de_cliente(n, self.CARPETAS), 'CORPORACION SOCIOCULTURAL CERROS FC')
        self.assertEqual(pe.carpeta_de_cliente('Nicolás Antonio Rave', self.CARPETAS), 'NICOLAS ANTONIO RAVE')
        self.assertIsNone(pe.carpeta_de_cliente('PEDRO PEREZ', self.CARPETAS))

    def test_lista_las_carpetas_de_MAESTROS(self):
        import shutil
        from app import club
        with tempfile.TemporaryDirectory() as d:
            raiz = Path(d)
            for proyecto in ('UNIFORMES 2027 FUTBOL', 'TEMPORADA 2026'):
                (raiz / 'CORPORACION SOCIOCULTURAL CERROS FC' / 'MAESTROS' / proyecto).mkdir(parents=True)
            (raiz / 'CORPORACION SOCIOCULTURAL CERROS FC' / 'MAESTROS' / 'suelto.txt').write_text('x')
            (raiz / 'NICOLAS ANTONIO RAVE').mkdir()
            pe._cache_carpetas.update(t=0.0, nombres=[]); pe._cache_proyectos.clear()
            with mock.patch.object(club, '_clientes_root', lambda: str(raiz)):
                r = pe.proyectos_de_cliente('CORPORACION SOCIOCULTURAL CERROS FUTBOL CLUB DE MEDELLIN S.A.S.')
                self.assertEqual(r['carpeta'], 'CORPORACION SOCIOCULTURAL CERROS FC')
                self.assertEqual(r['proyectos'], ['TEMPORADA 2026', 'UNIFORMES 2027 FUTBOL'])
                self.assertEqual(pe.proyectos_de_cliente('Nicolas Antonio Rave')['proyectos'], [])   # carpeta sin MAESTROS
                self.assertEqual(pe.proyectos_de_cliente('PEDRO PEREZ'), {'carpeta': None, 'proyectos': []})
            pe._cache_carpetas.update(t=0.0, nombres=[]); pe._cache_proyectos.clear()
