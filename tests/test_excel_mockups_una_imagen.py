import io
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlImage
from PIL import Image

from app import excel_mockups


def _png():
    buffer = io.BytesIO()
    Image.new('RGB', (40, 60), (200, 30, 30)).save(buffer, 'PNG')
    buffer.seek(0)
    return buffer


class MockupPlantillaUnaImagenTest(unittest.TestCase):
    def _listado(self, celda):
        carpeta = tempfile.mkdtemp()
        ruta = Path(carpeta) / 'listado.xlsx'
        wb = Workbook()
        hoja = wb.active
        hoja.title = 'A2102PT12'
        logo = XlImage(_png())
        hoja.add_image(logo, 'B2')   # el logo no cuenta como diseño
        diseno = XlImage(_png())
        hoja.add_image(diseno, celda)
        wb.save(ruta)
        return ruta

    def test_imagen_en_columna_n_se_toma_como_diseno_1(self):
        ruta = self._listado('N14')
        imagenes, estado = excel_mockups.extract_designs(str(ruta), ruta.stat().st_size, 'A2102PT12')
        self.assertEqual([n for n, _mime, _data in imagenes], [1])
        self.assertEqual(estado, '')

    def test_solo_el_logo_sigue_sin_imagen(self):
        carpeta = tempfile.mkdtemp()
        ruta = Path(carpeta) / 'listado.xlsx'
        wb = Workbook()
        wb.active.title = 'A2102PT12'
        wb.active.add_image(XlImage(_png()), 'B2')
        wb.save(ruta)
        imagenes, estado = excel_mockups.extract_designs(str(ruta), ruta.stat().st_size, 'A2102PT12')
        self.assertEqual(len(imagenes), 0)
        self.assertEqual(estado, 'Sin imagen en la hoja del listado')


if __name__ == '__main__':
    unittest.main()
