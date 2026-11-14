"""PDF de Effi para las cotizaciones de EMPEZAR PEDIDO: se pide a EFFITRON con un id sintético (el agente no cambia) y el resultado se guarda aparte del flujo de Tienda Club."""
import base64
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import effitron, pedido_effi as pe

PDF = b'%PDF-1.4 prueba'


class PdfDeEffi(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.addCleanup(self.d.cleanup)
        for objetivo, valor in (('PEDIDO_PDF_DIR', Path(self.d.name)),):
            m = mock.patch.object(effitron, objetivo, valor); m.start(); self.addCleanup(m.stop)
        effitron._pdf_pendientes.clear()
        self.addCleanup(effitron._pdf_pendientes.clear)

    def test_se_pide_una_vez_y_el_agente_recibe_un_trabajo_pdf_con_id_sintetico(self):
        self.assertEqual(effitron.solicitar_pdf_cotizacion(6373)['estado'], 'pendiente')
        self.assertEqual(effitron.solicitar_pdf_cotizacion(6373)['estado'], 'pendiente')   # pedirlo otra vez no lo duplica
        trabajos = effitron._trabajos_pdf_pedido(3)
        self.assertEqual(trabajos, [{'id': effitron.PEDIDO_PDF_BASE + 6373, 'tipo': 'pdf', 'cot_id': '6373'}])
        self.assertEqual(effitron._trabajos_pdf_pedido(3), [])   # ya se le entregó: no se repite hasta que venza

    def test_el_resultado_del_agente_guarda_el_pdf_y_queda_listo(self):
        effitron.solicitar_pdf_cotizacion(6373)
        effitron._resultado({'id': effitron.PEDIDO_PDF_BASE + 6373, 'ok': True, 'cot_id': '6373', 'pdf_b64': base64.b64encode(PDF).decode()})
        self.assertEqual(effitron.solicitar_pdf_cotizacion(6373)['estado'], 'listo')
        self.assertEqual(effitron.pdf_cotizacion_bytes(6373), PDF)

    def test_un_pdf_que_no_es_pdf_no_se_guarda_y_tras_varios_fallos_dice_error(self):
        effitron.solicitar_pdf_cotizacion(6373)
        for _ in range(effitron.MAX_INTENTOS):
            effitron._resultado({'id': effitron.PEDIDO_PDF_BASE + 6373, 'ok': True, 'pdf_b64': base64.b64encode(b'no es pdf').decode()})
        self.assertIsNone(effitron.pdf_cotizacion_bytes(6373))
        self.assertEqual(effitron.solicitar_pdf_cotizacion(6373)['estado'], 'pendiente')   # el REINTENTAR lo vuelve a pedir
        self.assertEqual(len(effitron._trabajos_pdf_pedido(3)), 1)

    def test_el_endpoint_entrega_el_pdf_o_404(self):
        with mock.patch.object(pe, '_usuario', lambda r: 'x'):
            with self.assertRaises(HTTPException) as e:
                pe.pdf_cotizacion(mock.Mock(), 6373)
            self.assertEqual(e.exception.status_code, 404)
            effitron.PEDIDO_PDF_DIR.mkdir(parents=True, exist_ok=True)
            effitron.pdf_cotizacion_ruta(6373).write_bytes(PDF)
            r = pe.pdf_cotizacion(mock.Mock(), 6373)
            self.assertEqual((r.media_type, r.body), ('application/pdf', PDF))
            self.assertIn('inline', r.headers['content-disposition'])


if __name__ == '__main__':
    unittest.main()
