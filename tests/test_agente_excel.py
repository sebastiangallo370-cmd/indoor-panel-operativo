"""AGENTE EXCEL: vinculación con código, trabajos solo para el agente de ESE comercial, plan de llenado y base sin datos."""
import json
import os
import tempfile
import time
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

os.environ.setdefault('SUPABASE_URL', 'http://x'); os.environ.setdefault('SUPABASE_KEY', 'x')
from app import agente_excel as ax, listado_pedido as lp

PLANTILLA = Path('/tmp/claude-0/pt/Plantilla.xlsm')


def pedir(token=''):
    r = mock.Mock(); r.headers = {'authorization': 'Bearer ' + token} if token else {}
    return r


class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory(); self.addCleanup(self.d.cleanup)
        for k, v in (('ESTADO', Path(self.d.name) / 'e.json'), ('CARPETA', Path(self.d.name) / 'trabajos')):
            m = mock.patch.object(ax, k, v); m.start(); self.addCleanup(m.stop)
        m = mock.patch.object(ax, '_auth', lambda r: 'ANA'); m.start(); self.addCleanup(m.stop)

    def vincular(self):
        codigo = ax.nuevo_codigo(mock.Mock())['codigo']
        return ax.enlazar({'codigo': codigo, 'equipo': 'PC-ANA', 'so': 'Windows'})['token']


class Vinculacion(Base):
    def test_el_codigo_sirve_una_sola_vez_y_el_token_identifica_al_comercial(self):
        codigo = ax.nuevo_codigo(mock.Mock())['codigo']
        r = ax.enlazar({'codigo': codigo.lower(), 'equipo': 'PC-ANA', 'so': 'Mac'})
        self.assertEqual(r['usuario'], 'ANA')
        with self.assertRaises(HTTPException):
            ax.enlazar({'codigo': codigo})
        self.assertTrue(ax.estado(mock.Mock())['conectado'])

    def test_sin_token_o_con_token_falso_no_entra(self):
        for t in ('', 'falso'):
            with self.assertRaises(HTTPException):
                ax.sondeo(pedir(t), {})


@unittest.skipUnless(PLANTILLA.is_file(), 'falta la plantilla real')
class Trabajo(Base):
    def excel(self):
        from PIL import Image
        doc = {'tipo': 'cotizacion', 'prefijo': 'CO', 'numero': '6374', 'fecha_entrega': '2026-12-10', 'proyecto': 'UNIFORMES 2027', 'cliente': {'nombre': 'CLUB SAN LORENZO'},
               'vendedor': 'CESAR', 'disenos': 1, 'conceptos': [{'referencia': 'A500PE01', 'descripcion': 'PETO', 'cantidad': 2, 'precio': 1}], 'subtotal': 2, 'total': 2}
        lis = {'A500PE01': [{'nombre': 'PEREZ', 'talla': 'M', 'numero': '9', 'diseno': 1, 'genero': 'MASC'}, {'nombre': '', 'talla': 'S', 'numero': '7', 'diseno': 1, 'genero': 'FEM'}]}
        arch = lp.preparar({'doc': doc, 'listado': lis, 'linea': 'PLUS', 'observaciones': ''}, lambda: PLANTILLA.read_bytes(), 'CESAR')
        carpeta = Path(self.d.name) / 'final'; carpeta.mkdir()
        final = carpeta / arch['excel_nombre']; final.write_bytes(arch['excel'])
        Image.new('RGB', (300, 500), (200, 0, 0)).save(carpeta / 'A500PE01_D1.png')
        from app.uploaded_mockups import embed_uploads
        embed_uploads(final, [carpeta / 'A500PE01_D1.png'], carpeta / 'bk', False)
        return final

    def test_sin_agente_conectado_no_se_encola(self):
        self.assertIsNone(ax.encolar('ANA', self.excel(), 'x.xlsm'))

    def test_plan_base_y_entrega_al_agente(self):
        from openpyxl import load_workbook
        token = self.vincular()
        final = self.excel()
        tid = ax.encolar('ANA', final, final.name)
        self.assertTrue(tid)
        plan = json.loads((ax.CARPETA / tid / 'plan.json').read_text())
        celdas = {c['celda']: c['valor'] for c in plan['hojas'][0]['celdas']}
        self.assertEqual((celdas['J2'], celdas['J3'], celdas['C8'], celdas['D8'], celdas['D9'], celdas['Q9']), ('CLUB SAN LORENZO', 'UNIFORMES 2027', 'PEREZ', 'M', 'S', 'X'))
        self.assertEqual(len(plan['hojas'][0]['imagenes']), 1)   # el mockup (el logo de la plantilla queda en la base)
        base = load_workbook(ax.CARPETA / tid / 'base.xlsm', keep_vba=True).worksheets[0]
        self.assertEqual((base['J2'].value, base['C8'].value, len(base._images)), (None, None, 1))
        r = ax.sondeo(pedir(token), {'version': '1.0.3'})
        self.assertEqual([t['id'] for t in r['trabajos']], [tid])
        self.assertEqual(ax.sondeo(pedir(token), {})['trabajos'], [])   # no se entrega dos veces
        self.assertEqual(str(ax.archivo(pedir(token), tid, 'base.xlsm').path), str(ax.CARPETA / tid / 'base.xlsm'))
        with self.assertRaises(HTTPException):
            ax.archivo(pedir(token), tid, '../e.json')
        ax.sondeo(pedir(token), {'resultados': [{'id': tid, 'estado': 'listo', 'detalle': 'Guardado'}]})
        self.assertEqual(ax.ver_trabajo(mock.Mock(), tid)['estado'], 'listo')

    def test_el_trabajo_de_un_comercial_no_le_llega_a_otro(self):
        token = self.vincular()
        with mock.patch.object(ax, '_auth', lambda r: 'LUIS'):
            otro = ax.enlazar({'codigo': ax.nuevo_codigo(mock.Mock())['codigo'], 'equipo': 'PC-LUIS'})['token']
        tid = ax.encolar('ANA', self.excel(), 'x.xlsm')
        self.assertEqual(ax.sondeo(pedir(otro), {})['trabajos'], [])
        with self.assertRaises(HTTPException):
            ax.archivo(pedir(otro), tid, 'base.xlsm')
        self.assertEqual(len(ax.sondeo(pedir(token), {'version': '1.0.3'})['trabajos']), 1)


if __name__ == '__main__':
    unittest.main()


class AgenteViejo(Trabajo):
    def test_agente_anterior_a_103_recibe_aviso_de_actualizar(self):
        token = self.vincular()
        tid = ax.encolar('ANA', self.excel(), 'x.xlsm')
        self.assertEqual(ax.sondeo(pedir(token), {'version': '1.0.2'})['trabajos'], [])
        with mock.patch.object(ax, '_auth', lambda r: 'ANA'):
            t = ax.ver_trabajo(mock.Mock(), tid)
        self.assertEqual(t['estado'], 'error')
        self.assertIn('desactualizado', t['detalle'])


class ExcelFinal(Base):
    def test_el_excel_que_llena_el_agente_se_recibe_y_se_avisa_al_servidor(self):
        import asyncio
        token = self.vincular()
        recibido = []
        ax.configurar(lambda r: 'ANA', lambda codigo, nombre, ruta: recibido.append((codigo, nombre, Path(ruta).read_bytes()[:2])))
        tid = ax.encolar.__globals__['secrets'].token_hex(8)
        with ax._lock:
            d = ax._leer(); d['trabajos'][tid] = {'usuario': 'ANA', 'nombre': 'CO6385_UNIFORMES 2027.xlsm', 'estado': 'llenando', 'detalle': '', 'creado': 0, 'base': 'base.xlsm', 'celdas': 1}; ax._guardar(d)
        class Req:
            headers = {'authorization': 'Bearer ' + token}
            async def body(self): return b'PK\x03\x04contenido'
        r = asyncio.run(ax.recibir_final(Req(), tid))
        self.assertTrue(r['ok'])
        self.assertEqual(recibido, [('CO6385', 'CO6385_UNIFORMES 2027.xlsm', b'PK')])
        class Malo(Req):
            async def body(self): return b'no es un excel'
        with self.assertRaises(HTTPException):
            asyncio.run(ax.recibir_final(Malo(), tid))


@unittest.skipUnless(PLANTILLA.is_file(), 'falta la plantilla real')
class AgenteCerrado(Trabajo):
    def test_si_el_agente_esta_cerrado_el_trabajo_espera_y_vence_a_los_15_minutos(self):
        token = self.vincular()
        with ax._lock:
            d = ax._leer()
            for e in d['equipos'].values():
                e['visto'] = 0   # agente cerrado desde hace mucho
            ax._guardar(d)
        tid = ax.encolar('ANA', self.excel(), 'x.xlsm')
        self.assertTrue(tid)   # antes devolvía None y el Excel nunca se abría
        self.assertIn('cerrado', ax.ver_trabajo(mock.Mock(), tid)['detalle'])
        r = ax.sondeo(pedir(token), {'version': '1.1.3'})   # el agente se abre: recibe el trabajo que estaba esperando
        self.assertEqual([t['id'] for t in r['trabajos']], [tid])
        with ax._lock:
            d = ax._leer(); d['trabajos'][tid]['estado'] = 'pendiente'; d['trabajos'][tid]['creado'] -= 1000; ax._guardar(d)
        self.assertEqual(ax.sondeo(pedir(token), {'version': '1.1.3'})['trabajos'], [])   # pasaron 15 min: ya no se abre sola
        self.assertEqual(ax.ver_trabajo(mock.Mock(), tid)['estado'], 'error')


class Abridor(Base):
    def test_el_abridor_bat_busca_y_lanza_el_agente(self):
        ax.configurar(lambda r: 'ANA')
        r = ax.abridor_bat(mock.Mock())
        cuerpo = r.body.decode()
        self.assertIn('AgenteExcelIndoor.exe', cuerpo)
        self.assertIn('start "" "%EXE%"', cuerpo)
        self.assertIn('\r\n', cuerpo)
        self.assertIn('abrir', r.headers['content-disposition'].lower())
