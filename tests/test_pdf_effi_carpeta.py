"""En la carpeta de la orden solo puede quedar el PDF que baja EFFITRON de Effi; el que arma el panel se retira."""
import base64
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

T = Path(tempfile.mkdtemp())
for k, v in dict(NAS_CLIENTES_PATH=str(T / 'C'), SUPABASE_URL='http://x', SUPABASE_KEY='x', GOOGLE_SHEETS_URL='http://x', GOOGLE_CREDENTIALS='{}',
                 PAGOS_COTIZACIONES_FILE_ID='x', PAGOS_COTIZACIONES_HOJA='x', SMTP_EMAIL='x', SMTP_PASSWORD='x', DATA_DIR=str(T / 'd'), APP_USER='u', APP_PASSWORD='p').items():
    os.environ.setdefault(k, v)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main, effitron  # noqa: E402

PANEL = b'%PDF-ARMADO POR EL PANEL (2 KB)'
EFFI = b'%PDF-1.4 PDF REAL DE EFFI con logo ' + b'X' * 5000


class PdfEffiCarpeta(unittest.TestCase):
    def setUp(self):
        self.orden = Path(tempfile.mkdtemp()) / 'CO6392_UNIFORMES 2027'
        self.orden.mkdir(parents=True)
        (self.orden / 'CO6392.pdf').write_bytes(PANEL)   # lo que deja el programar pedido
        main.find_nas_order = lambda c: self.orden
        main.STATE_DIR = Path(tempfile.mkdtemp())
        effitron.PEDIDO_PDF_DIR = Path(tempfile.mkdtemp())
        effitron._pdf_pendientes.clear()
        main._POST_ORDEN.clear()
        main._registrar_post_orden('CO6392', pdf_effi=6392, pdf_hecho=False)

    def test_sin_pdf_de_effi_no_queda_el_del_panel(self):
        main._aplicar_post_orden('CO6392')
        self.assertEqual(list(self.orden.glob('*.pdf')), [])

    def test_cuando_llega_el_de_effi_es_el_unico_pdf(self):
        main._aplicar_post_orden('CO6392')   # todavía sin PDF de Effi
        effitron.solicitar_pdf_cotizacion(6392)
        effitron._resultado_pdf_pedido({'id': effitron.PEDIDO_PDF_BASE + 6392, 'ok': True, 'pdf_b64': base64.b64encode(EFFI).decode()})
        main._aplicar_post_orden('CO6392')
        pdfs = list(self.orden.glob('*.pdf'))
        self.assertEqual([p.name for p in pdfs], ['CO6392.pdf'])
        self.assertEqual(pdfs[0].read_bytes(), EFFI)

    def test_si_algo_vuelve_a_dejar_el_del_panel_se_repone_el_de_effi(self):
        effitron.PEDIDO_PDF_DIR.mkdir(parents=True, exist_ok=True)
        effitron.pdf_cotizacion_ruta(6392).write_bytes(EFFI)
        main._aplicar_post_orden('CO6392')
        (self.orden / 'CO6392.pdf').write_bytes(PANEL)
        main._aplicar_post_orden('CO6392')
        self.assertEqual((self.orden / 'CO6392.pdf').read_bytes(), EFFI)


if __name__ == '__main__':
    unittest.main()
