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
CATALOGO = {'formas_pago': FORMAS, 'sucursales': [], 'bodegas': [], 'centros': [], 'vendedores': []}
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


class Crear(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        m = mock.patch.object(pe, 'ACTIVO_ARCHIVO', Path(self.tmp.name) / 'activo')
        m.start(); self.addCleanup(m.stop)
        m = mock.patch.dict(os.environ, {'PEDIDO_EFFI_ACTIVO': ''})
        m.start(); self.addCleanup(m.stop)
        pe.configurar(lambda r: 'Ana', lambda u: u == 'Ana', lambda: 'llave', lambda u: u == 'Ana')

    def test_apagado_por_defecto_no_crea_nada(self):
        self.assertFalse(pe.activo())
        with mock.patch.object(effi_api, 'crear_cotizacion') as c:
            with self.assertRaises(HTTPException) as e:
                pe.crear(object(), base())
            self.assertEqual(e.exception.status_code, 409)
            c.assert_not_called()

    def test_encendido_crea_la_cotizacion_y_la_remision(self):
        pe.cambiar_activo(object(), {'activo': True})
        self.assertTrue(pe.activo())
        art = mock.patch.object(effi_api, 'articulo', articulo)
        imp = mock.patch.object(effi_api, 'impuestos_de', lambda t: [])
        cat = mock.patch.object(pe, '_catalogos', lambda: CATALOGO)
        with art, imp, cat, mock.patch.object(effi_api, 'crear_cotizacion', return_value={'id': '6400', 'prefijo': 'CO', 'total': 700000}) as c, \
                mock.patch.object(effi_api, 'crear_remision', return_value={'id': '88', 'prefijo': 'RV', 'total': 700000}) as r:
            a = pe.crear(object(), base())
            self.assertEqual((a['numero'], a['tipo']), ('CO6400', 'cotización'))
            b = pe.crear(object(), base(tipo='remision', formas_pago=[{'id': 6}]))
            self.assertEqual(b['numero'], 'RV88')
            self.assertEqual((c.call_count, r.call_count), (1, 1))
        pe.cambiar_activo(object(), {'activo': False})
        self.assertFalse(pe.activo())

    def test_permisos(self):
        pe.configurar(lambda r: 'Otro', lambda u: False, lambda: 'llave', lambda u: False)
        for f in (lambda: pe.estado(object()), lambda: pe.crear(object(), base()), lambda: pe.cambiar_activo(object(), {'activo': True})):
            with self.assertRaises(HTTPException) as e:
                f()
            self.assertEqual(e.exception.status_code, 403)
        pe.configurar(lambda r: 'Comercial', lambda u: True, lambda: 'llave', lambda u: False)
        with self.assertRaises(HTTPException) as e:
            pe.cambiar_activo(object(), {'activo': True})
        self.assertEqual(e.exception.status_code, 403)   # comercial sí usa el formulario, pero no lo enciende


if __name__ == '__main__':
    unittest.main()
