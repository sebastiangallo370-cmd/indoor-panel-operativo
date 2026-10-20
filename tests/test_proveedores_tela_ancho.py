import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from app import proveedores_tela as pt


class AnchoTelaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._file = pt._file
        pt._file = Path(self.tmp.name) / 'p.json'
        pt.configurar(lambda: [{'nombre': '(100) MONTECATINI BLANCO', 'categoria': 'BODEGA TELA', 'mts': 10, 'rolls': 1}])

    def tearDown(self):
        pt._file = self._file
        pt.configurar(lambda: [])
        self.tmp.cleanup()

    def test_faltan_los_datos_obligatorios(self):
        self.assertEqual(pt.telas()[0]['faltan'], ['proveedor', 'ancho'])

    def test_guardar_por_separado_conserva_el_otro_dato(self):
        pt.guardar({'codigo': '100', 'proveedor': 'LINDATEXTIL'}, None)
        pt.guardar({'codigo': '100', 'ancho': '150,5'}, None)
        t = pt.telas()[0]
        self.assertEqual((t['proveedor'], t['ancho'], t['faltan']), ('LINDATEXTIL', '150.5', []))
        pt.guardar({'codigo': '100', 'proveedor': ''}, None)
        self.assertEqual(pt.telas()[0]['ancho'], '150.5')

    def test_id_effi_opcional_y_numerico(self):
        pt.guardar({'codigo': '100', 'id_effi': '4821'}, None)
        t = pt.telas()[0]
        self.assertEqual((t['id_effi'], t['faltan']), ('4821', ['proveedor', 'ancho']))   # no cuenta como dato obligatorio
        with self.assertRaises(HTTPException):
            pt.guardar({'codigo': '100', 'id_effi': 'abc'}, None)

    def test_ancho_no_valido(self):
        with self.assertRaises(HTTPException):
            pt.guardar({'codigo': '100', 'ancho': 'abc'}, None)
        with self.assertRaises(HTTPException):
            pt.guardar({'codigo': '100', 'ancho': '5'}, None)


if __name__ == '__main__':
    unittest.main()
