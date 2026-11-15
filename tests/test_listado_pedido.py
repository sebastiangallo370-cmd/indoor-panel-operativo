"""LISTADO DEL PEDIDO: validación, Excel con la plantilla y, sobre todo, que el PDF que genera el panel lo lea el programar pedido REAL (pedidos_legacy.extraer_info_pdf)."""
import io
import os
import tempfile
import unittest

from openpyxl import Workbook, load_workbook

from app import listado_pedido as lp

DOC = {'tipo': 'cotizacion', 'prefijo': 'CO', 'numero': '6400', 'fecha_creacion': '2026-11-13', 'fecha_entrega': '2026-11-28', 'proyecto': 'TEMPORADA 2027',
       'cliente': {'nombre': 'CLUB DEPORTIVO CERROS S.A.S.', 'documento': 'NIT 900123456'}, 'vendedor': 'CESAR ANDRES LOPEZ ZULUAGA', 'disenos': 2,
       'conceptos': [{'referencia': 'A100CA02', 'descripcion': 'CAMISETA TIPO POLO', 'cantidad': 3, 'precio': 71000},
                     {'referencia': 'A200SH01', 'descripcion': 'SHORT DEPORTIVO', 'cantidad': 2, 'precio': 45000}],
       'subtotal': 323000, 'total': 384370}
FILAS_POLO = [{'nombre': 'PEREZ', 'talla': 'M', 'numero': '10', 'diseno': 1, 'genero': 'MASC'},
              {'nombre': 'GOMEZ DIAZ', 'talla': 'L', 'numero': '7', 'diseno': 1, 'genero': 'MASC', 'observacion': 'zurdo'},
              {'nombre': 'ANA', 'talla': 'S', 'numero': '', 'diseno': 2, 'genero': 'FEM'}]
FILAS_SHORT = [{'nombre': '', 'talla': '14', 'numero': '3', 'diseno': 1, 'genero': 'MASC'}, {'nombre': '', 'talla': 'M', 'numero': '', 'diseno': 1, 'genero': 'MASC'}]
LISTADO = {'A100CA02': FILAS_POLO, 'A200SH01': FILAS_SHORT}


def plantilla_falsa() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws['AG3'] = 1
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class Validar(unittest.TestCase):
    def test_listado_completo_pasa(self):
        g = lp.validar(DOC, LISTADO)
        self.assertEqual([(x['referencia'], x['cantidad'], len(x['filas'])) for x in g], [('A100CA02', 3, 3), ('A200SH01', 2, 2)])

    def test_faltan_y_sobran_se_dicen_con_su_referencia(self):
        with self.assertRaises(ValueError) as e:
            lp.validar(DOC, {'A100CA02': FILAS_POLO[:2], 'A200SH01': FILAS_SHORT + FILAS_SHORT[:1]})
        self.assertIn('A100CA02: la cotización dice 3 prendas y el listado tiene 2 (faltan 1)', str(e.exception))
        self.assertIn('A200SH01: la cotización dice 2 prendas y el listado tiene 3 (sobran 1)', str(e.exception))

    def test_talla_genero_y_diseno_obligatorios_y_todos_los_errores_juntos(self):
        mal = [dict(FILAS_POLO[0], talla=''), dict(FILAS_POLO[1], genero=''), dict(FILAS_POLO[2], diseno=3)]
        with self.assertRaises(ValueError) as e:
            lp.validar(DOC, {'A100CA02': mal, 'A200SH01': FILAS_SHORT})
        t = str(e.exception)
        self.assertIn('fila 1: falta la talla', t); self.assertIn('fila 2: elige el género', t); self.assertIn('fila 3: el diseño debe estar entre D1 y D2', t)

    def test_misma_referencia_en_dos_conceptos_suma_cantidades(self):
        d = dict(DOC, conceptos=[{'referencia': 'A200SH01', 'cantidad': 1, 'precio': 1}, {'referencia': 'a200sh01', 'cantidad': 1, 'precio': 1}])
        self.assertEqual(lp.validar(d, {'A200SH01': FILAS_SHORT})[0]['cantidad'], 2)

    def test_referencia_que_el_programar_pedido_no_toma_se_rechaza_antes_de_enviar(self):
        import re
        for buena in ('A100CA02', 'A200SH01', 'A100CA02-A100CA03'):
            self.assertTrue(lp.REF_PRODUCCION_RE.match(buena), buena)
        for mala in ('SH01', 'A1000CPDVS-S', 'FUT01', 'COPA'):
            self.assertFalse(lp.REF_PRODUCCION_RE.match(mala), mala)
        with self.assertRaises(ValueError) as e:
            lp.validar(dict(DOC, conceptos=[{'referencia': 'A1000CPDVS-S', 'cantidad': 1, 'precio': 1}]), {'A1000CPDVS-S': FILAS_SHORT[:1]})
        self.assertIn('no tiene formato de referencia de producción', str(e.exception))

    def test_el_patron_es_igual_al_del_programar_pedido_real(self):
        import os, sys
        os.environ.setdefault('SUPABASE_URL', 'http://x'); os.environ.setdefault('SUPABASE_KEY', 'x')
        import pedidos_legacy as pl
        self.assertEqual(lp.REF_PRODUCCION_RE.pattern, pl.REF_HOJA_RE.pattern)

    def test_cantidad_no_entera_o_proyecto_vacio(self):
        with self.assertRaises(ValueError):
            lp.validar(dict(DOC, conceptos=[{'referencia': 'A100CA02', 'cantidad': 1.5}]), {})
        with self.assertRaises(ValueError) as e:
            lp.validar(dict(DOC, proyecto=''), LISTADO)
        self.assertIn('proyecto', str(e.exception))


class Excel(unittest.TestCase):
    def test_una_hoja_por_referencia_con_la_cabecera_y_las_filas(self):
        nombre, datos = lp.excel_listado(DOC, lp.validar(DOC, LISTADO), plantilla_falsa(), 'CESAR', 'plus')
        self.assertEqual(nombre, 'CO6400_CLUB_DEPORTIVO_CERROS_S_A_S.xlsm')
        wb = load_workbook(io.BytesIO(datos))
        self.assertEqual(wb.sheetnames, ['A100CA02', 'A200SH01'])
        ws = wb['A100CA02']
        self.assertEqual((ws['J2'].value, ws['J3'].value, ws['J4'].value, ws['J6'].value), ('CLUB DEPORTIVO CERROS S.A.S.', 'TEMPORADA 2027', 'CESAR', 'plus'))
        fila = lambda n: [ws.cell(row=n, column=c).value for c in (3, 4, 5, 10, 11, 16, 17, 18)]
        self.assertEqual(fila(8), ['PEREZ', 'M', '10', 'X', None, 'X', None, None])
        self.assertEqual(fila(9), ['GOMEZ DIAZ', 'L', '7', 'X', None, 'X', None, 'zurdo'])
        self.assertEqual(fila(10), ['ANA', 'S', None, None, 'X', None, 'X', None])      # diseño 2 y género FEM
        self.assertEqual(wb['A200SH01']['D8'].value, '14')
        self.assertEqual(ws['AG3'].value, 2)


class BloquesPorDiseno(unittest.TestCase):
    def test_cada_diseno_va_en_su_bloque_d1_primero(self):
        filas = [dict(FILAS_POLO[2]), dict(FILAS_POLO[0]), dict(FILAS_POLO[1])]   # D2 escrito primero en pantalla
        _, datos = lp.excel_listado(DOC, lp.validar(DOC, {'A100CA02': filas, 'A200SH01': FILAS_SHORT}), plantilla_falsa(), 'CESAR', 'plus')
        ws = load_workbook(io.BytesIO(datos))['A100CA02']
        self.assertEqual([(ws.cell(row=r, column=3).value, ws.cell(row=r, column=10).value, ws.cell(row=r, column=11).value) for r in (8, 9, 10)],
                         [('PEREZ', 'X', None), ('GOMEZ DIAZ', 'X', None), ('ANA', None, 'X')])


class PdfLeidoPorElProgramarPedidoReal(unittest.TestCase):
    def test_el_programar_pedido_lee_el_pdf_del_panel(self):
        os.environ.setdefault('SUPABASE_URL', 'http://x'); os.environ.setdefault('SUPABASE_KEY', 'x')
        import pedidos_legacy as pl
        pdf = lp.pdf_cotizacion(DOC, lp.validar(DOC, LISTADO))
        self.assertEqual(pdf[:4], b'%PDF')
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, 'CO6400.pdf')
            open(ruta, 'wb').write(pdf)
            resultados, header, items, avisos = pl.extraer_info_pdf(ruta)
        self.assertEqual((header['cliente'], header['vendedor'], header['proyecto'], header['orden'], header['tipo_doc']),
                         ('CLUB DEPORTIVO CERROS SAS', 'CESAR ANDRES LOPEZ ZULUAGA', 'TEMPORADA 2027', 'CO6400', 'COTIZACION'))
        self.assertEqual((str(header['fecha_entrega_date']), header['subtotal'], header['total_neto']), ('2026-11-28', 323000, 384370))
        self.assertEqual({r['referencia']: r['cantidad'] for r in resultados}, {'A100CA02': '3', 'A200SH01': '2'})
        self.assertEqual([(i['ref'], i['diseno'], i['genero'], i['cantidad'], len(i['tallas'])) for i in items],
                         [('A100CA02', 1, 'MASC', 2, 2), ('A100CA02', 2, 'FEM', 1, 1), ('A200SH01', 1, 'MASC', 2, 2)])
        self.assertEqual(avisos, [])   # sin avisos: ni diseño ni género asumidos

    def test_remision_usa_el_prefijo_rm(self):
        d = dict(DOC, tipo='remision', prefijo='RV', numero='88')
        self.assertEqual(lp.prefijo_numero(d), ('RM', '88'))


class Preparar(unittest.TestCase):
    def test_arma_los_dos_archivos_con_nombres_que_el_programar_pedido_entiende(self):
        r = lp.preparar({'doc': DOC, 'listado': LISTADO, 'linea': 'plus', 'observaciones': 'urgente'}, plantilla_falsa)
        self.assertEqual((r['pdf_nombre'], r['excel_nombre'][:7], r['linea'], r['observaciones']), ('CO6400.pdf', 'CO6400_', 'PLUS', 'urgente'))
        import pedidos_legacy as pl
        self.assertEqual(pl.extraer_prefijo_numero_nombre(r['pdf_nombre']), ('CO', '6400'))
        self.assertEqual(pl.extraer_prefijo_numero_nombre(r['excel_nombre']), ('CO', '6400'))


if __name__ == '__main__':
    unittest.main()


class PestanasPorFamilia(unittest.TestCase):
    def test_familia_en_una_pestana_d1_primero(self):
        from app import listado_pedido as L
        f = lambda r, d: {'nombre': r, 'diseno': d, 'filas': []}
        gs = [{'referencia': 'A200FUT01', 'cantidad': 2, 'filas': [f('a', 2), f('b', 1)]},
              {'referencia': 'A200FUT02', 'cantidad': 1, 'filas': [f('c', 1)]},
              {'referencia': 'A100CA02', 'cantidad': 1, 'filas': [f('d', 1)]}]
        h = L.hojas_por_familia(gs)
        self.assertEqual([x['referencia'] for x in h], ['A200FUT01-A200FUT02', 'A100CA02'])
        self.assertEqual([x['nombre'] for x in h[0]['filas']], ['b', 'c', 'a'])
        self.assertEqual(h[0]['cantidad'], 3)
