"""Configuración blindada del programar pedido: cada cosa que ya quedó bien NO debe volver a fallar.

- Cada mockup cae en el recuadro de SU diseño (D1 en AH, D2 en AN, … D20 en ER) y dentro de él, centrado.
- El tipo de aplique va en OBSERVACIONES Y NOTAS de cada diseño, centrado y en letra 14; con NO no se escribe nada.
- El Sheet de Producción recibe solo SI o NO en el aplique; la línea sale de cada referencia.
- La hoja del Excel conserva la línea y el aplique de SU referencia (no los de la primera).
"""
import io
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))

from openpyxl import Workbook, load_workbook  # noqa: E402
from PIL import Image  # noqa: E402

import listado_pedido  # noqa: E402
import sheet_pedidos  # noqa: E402
import uploaded_mockups  # noqa: E402

S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
X = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'


def plantilla_con_bloques(tmp: Path, hoja: str = 'A100FUT02', disenos: int = 20) -> Path:
    """Plantilla mínima con el encabezado «DISEÑO n» cada 6 columnas desde AH, como la de Indoor."""
    wb = Workbook()
    ws = wb.active
    ws.title = hoja
    for d in range(1, disenos + 1):
        ws.cell(row=2, column=34 + 6 * (d - 1), value=f'DISEÑO {d}')
        ws.cell(row=29, column=34 + 6 * (d - 1), value='OBSERVACIONES Y NOTAS')
    ruta = tmp / 'plantilla.xlsx'
    wb.save(ruta)
    return ruta


def imagenes_de_prueba(tmp: Path, hoja: str, cantidad: int) -> list:
    rutas = []
    for d in range(1, cantidad + 1):
        p = tmp / f'{hoja}_D{d}.png'
        Image.new('RGB', (300, 400), ((d * 37) % 255, (d * 91) % 255, (d * 53) % 255)).save(p)
        rutas.append(p)
    return rutas


def columnas_de_imagenes(ruta: Path) -> list:
    z = zipfile.ZipFile(ruta)
    cols = []
    for n in z.namelist():
        if 'xl/drawings/' in n and n.endswith('.xml') and '_rels' not in n:
            for anc in ET.fromstring(z.read(n)):
                if not anc.tag.endswith('Anchor'):
                    continue
                col = next((int(c.text) for el in anc.iter() if el.tag.endswith('from') for c in el if c.tag.endswith('col')), None)
                if any(el.tag.endswith('blip') for el in anc.iter()) and col is not None:
                    cols.append(col)
    return sorted(cols)


class MockupsEnSuBloque(unittest.TestCase):
    def test_d1_a_d3_caen_en_AH_AN_AT(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            plantilla = plantilla_con_bloques(tmp, disenos=3)
            ruta = tmp / 'listado.xlsx'
            ruta.write_bytes(plantilla.read_bytes())
            ins, avisos = uploaded_mockups.embed_uploads(ruta, imagenes_de_prueba(tmp, 'A100FUT02', 3), tmp / 'resp', False)
            self.assertEqual(ins, 3)
            self.assertEqual(avisos, [])
            self.assertEqual(columnas_de_imagenes(ruta), [33, 39, 45])   # AH, AN, AT (0 = A)

    def test_hasta_D20_caen_en_su_bloque(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            plantilla = plantilla_con_bloques(tmp, disenos=20)
            ruta = tmp / 'listado.xlsx'
            ruta.write_bytes(plantilla.read_bytes())
            ins, _ = uploaded_mockups.embed_uploads(ruta, imagenes_de_prueba(tmp, 'A100FUT02', 20), tmp / 'resp', False)
            self.assertEqual(ins, 20)
            self.assertEqual(columnas_de_imagenes(ruta), [33 + 6 * k for k in range(20)])   # AH … ER

    def test_imagen_cabe_y_queda_centrada_en_el_recuadro(self):
        ancho_col = 64.0
        sheet = ET.fromstring(f'<worksheet xmlns="{S}"><sheetData/></worksheet>')
        marcas, escala = uploaded_mockups._colocar(sheet, 33, 300, 400)
        valores = dict(marcas)
        self.assertTrue(33 <= valores['col'] <= 37)   # dentro de las 5 columnas del recuadro, desde AH
        self.assertGreaterEqual(valores['colOff'], 0)
        self.assertGreater(escala, 0)
        # la imagen escalada no pasa del recuadro (5 columnas de 64 px, 25 filas de 20 px)
        self.assertLessEqual(300 * escala, 5 * ancho_col)
        self.assertLessEqual(400 * escala, 25 * 20.0)


class AplicueYNotas(unittest.TestCase):
    def test_tipos_van_en_cada_diseno_centrados_y_en_14(self):
        wb = Workbook()
        ws = wb.active
        ws.title = 'A100FUT02'
        g = {'referencia': 'A100FUT02', 'textura': 'SI', 'tipos': ['TEXTURIZADO TPU', 'DTF/VINILO'],
             'filas': [{'nombre': 'A', 'talla': 'M', 'numero': '1', 'diseno': 1, 'genero': 'MASC', 'observacion': ''},
                       {'nombre': 'B', 'talla': 'M', 'numero': '2', 'diseno': 2, 'genero': 'MASC', 'observacion': ''}]}
        listado_pedido._llenar_hoja(ws, {'cliente': {'nombre': 'C'}}, g, '', 'PREMIUM')
        self.assertEqual(ws['AH29'].value, 'TEXTURIZADO TPU\nDTF/VINILO')
        self.assertEqual(ws['AH29'].alignment.horizontal, 'center')
        self.assertEqual(ws['AH29'].alignment.vertical, 'center')
        self.assertEqual(ws['AH29'].font.sz, 14)

    def test_con_NO_no_se_escribe_nada(self):
        self.assertEqual(listado_pedido._aplique_texto({'textura': 'NO', 'tipos': ['BORDADO']}), '')
        self.assertEqual(listado_pedido._aplique_texto({'textura': '', 'tipos': []}), '')

    def test_sheet_solo_SI_o_NO(self):
        self.assertEqual(sheet_pedidos._textura_texto('SI', ['BORDADO', 'DTF/VINILO']), 'SI')
        self.assertEqual(sheet_pedidos._textura_texto('NO', []), 'NO')
        self.assertEqual(sheet_pedidos._textura_texto('', None), '')


class LineaYAplicuePorReferencia(unittest.TestCase):
    def test_cada_hoja_conserva_su_linea_y_su_aplique(self):
        grupos = [
            {'referencia': 'A100FUT01', 'cantidad': 1, 'filas': [], 'proyecto': 'P', 'linea': 'ESTANDAR', 'textura': 'NO', 'tipos': []},
            {'referencia': 'A100FUT02', 'cantidad': 2, 'filas': [], 'proyecto': 'P', 'linea': 'PREMIUM', 'textura': 'SI', 'tipos': ['BORDADO']},
        ]
        hojas = listado_pedido.hojas_por_familia(grupos)
        por_ref = {h['referencia']: h for h in hojas}
        self.assertEqual(por_ref['A100FUT02']['linea'], 'PREMIUM')
        self.assertEqual(por_ref['A100FUT02']['textura'], 'SI')
        self.assertEqual(por_ref['A100FUT02']['tipos'], ['BORDADO'])
        self.assertEqual(por_ref['A100FUT01']['linea'], 'ESTANDAR')
        self.assertEqual(por_ref['A100FUT01']['textura'], 'NO')


if __name__ == '__main__':
    unittest.main()
