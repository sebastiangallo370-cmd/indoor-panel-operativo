"""El PDF de la orden: solo se acepta un PDF válido y pequeño, y se adjunta al correo."""
import base64
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import zeus

PDF = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'


class PdfOrden(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(zeus, '_pdfs', Path(self.dir.name))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.dir.cleanup()

    def test_guarda_y_adjunta(self):
        nombre = zeus._guardar_pdf('136', base64.b64encode(PDF).decode())
        self.assertEqual(nombre, 'OC-136.pdf')
        adj = zeus._pdf_de({'oc': '136', 'pdf': nombre})
        self.assertEqual(adj, [('Orden de compra 136.pdf', PDF)])

    def test_rechaza_lo_que_no_es_pdf(self):
        self.assertEqual(zeus._guardar_pdf('136', base64.b64encode(b'<html>no soy pdf</html>').decode()), '')
        self.assertEqual(zeus._guardar_pdf('136', ''), '')
        self.assertEqual(zeus._pdf_de({'oc': '1', 'pdf': ''}), [])

    def test_nombre_seguro(self):
        self.assertEqual(zeus._guardar_pdf('../../x 7', base64.b64encode(PDF).decode()), 'OC-x7.pdf')


if __name__ == '__main__':
    unittest.main()
