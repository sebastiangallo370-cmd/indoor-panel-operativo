"""Cola de PDFs de Effi: cotización y remisión no se mezclan (mismo número, archivos y trabajos distintos)."""
import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import effitron  # noqa: E402

PDF_MIN = b'%PDF-1.4\n%test\n'


class PdfRemisionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._dir = effitron.PEDIDO_PDF_DIR
        effitron.PEDIDO_PDF_DIR = Path(self._tmp.name)
        effitron._pdf_pendientes.clear()
        self._agente = mock.patch.object(effitron, 'agente', return_value={'conectado': True})
        self._agente.start()

    def tearDown(self):
        self._agente.stop()
        effitron._pdf_pendientes.clear()
        effitron.PEDIDO_PDF_DIR = self._dir
        self._tmp.cleanup()

    def test_rutas_separadas(self):
        self.assertEqual(effitron.pdf_ruta('cotizacion', 7746).name, 'cotizacion-7746.pdf')
        self.assertEqual(effitron.pdf_ruta('remision', 7746).name, 'remision-7746.pdf')
        self.assertNotEqual(effitron.pdf_ruta('cotizacion', 7746), effitron.pdf_ruta('remision', 7746))

    def test_solicitar_remision_no_toca_la_cotizacion(self):
        effitron.solicitar_pdf('cotizacion', 7746)
        effitron.solicitar_pdf('remision', 7746)
        self.assertIn(7746, effitron._pdf_pendientes)
        self.assertIn(-7746, effitron._pdf_pendientes)

    def test_trabajo_y_resultado_remision(self):
        effitron.solicitar_pdf('remision', 7746)
        trabajos = effitron._trabajos_pdf_pedido(5)
        self.assertEqual(len(trabajos), 1)
        t = trabajos[0]
        self.assertEqual(t['doc'], 'remision')
        self.assertEqual(t['cot_id'], '7746')
        self.assertEqual(t['id'], effitron.PEDIDO_PDF_BASE + effitron.REMISION_PDF_OFFSET + 7746)
        effitron._resultado_pdf_pedido({'id': t['id'], 'ok': True, 'pdf_b64': base64.b64encode(PDF_MIN).decode()})
        self.assertEqual(effitron.pdf_bytes_doc('remision', 7746), PDF_MIN)
        self.assertIsNone(effitron.pdf_bytes_doc('cotizacion', 7746))
        self.assertEqual(effitron.solicitar_pdf('remision', 7746)['estado'], 'listo')

    def test_trabajo_cotizacion_sigue_igual(self):
        effitron.solicitar_pdf('cotizacion', 7746)
        t = effitron._trabajos_pdf_pedido(5)[0]
        self.assertEqual(t['doc'], 'cotizacion')
        self.assertEqual(t['id'], effitron.PEDIDO_PDF_BASE + 7746)
        effitron._resultado_pdf_pedido({'id': t['id'], 'ok': True, 'pdf_b64': base64.b64encode(PDF_MIN).decode()})
        self.assertEqual(effitron.pdf_cotizacion_bytes(7746), PDF_MIN)


if __name__ == '__main__':
    unittest.main()
