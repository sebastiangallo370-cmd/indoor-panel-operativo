"""El proveedor de INFORMACIÓN TELA se guarda y se muestra con la razón social de sus facturas (y su NIT)."""
import os
import tempfile
import unittest

os.environ.setdefault('PROVEEDORES_TELA_FILE', os.path.join(tempfile.mkdtemp(), 'proveedores_tela.json'))

from app import proveedores_tela as p  # noqa: E402


class RazonSocial(unittest.TestCase):
    def test_nombres_cortos_dan_la_razon_social(self):
        self.assertEqual(p.razon_social('LINDATEXTIL'), ('TEJIDOS DE PUNTO LINDATEXTIL S.A.S.', '901018972-1'))
        self.assertEqual(p.razon_social('la fayette'), ('TEXTILES LAFAYETTE SAS', '860001965'))
        self.assertEqual(p.razon_social('ELIOT'), ('MANUFACTURAS ELIOT S.A.S', '860000452'))
        self.assertEqual(p.razon_social('Saraxy'), ('SARAXY S.A.S', '900306394-6'))
        self.assertEqual(p.razon_social('MERCANTIL DE TEXTILES'), ('MERCANTIL DE TEXTILES S.A.S.', '890914669'))

    def test_la_razon_social_escrita_distinto_se_reconoce(self):
        self.assertEqual(p.razon_social('Textiles Lafayette S.A.S.')[0], 'TEXTILES LAFAYETTE SAS')

    def test_desconocidos_no_cambian(self):
        self.assertIsNone(p.razon_social('PUNTOFLEX'))
        self.assertEqual(p._prov_inventario('PUNTOFLEX'), 'PUNTOFLEX')
        self.assertEqual(p._prov_inventario('VARIAS'), '')

    def test_alias_para_buscar_en_effi(self):
        self.assertIn('LAFAYETTE', p.alias_de('TEXTILES LAFAYETTE SAS'))
        self.assertEqual(p.alias_de('PUNTOFLEX'), [])


if __name__ == '__main__':
    unittest.main()
