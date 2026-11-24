import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import effitron  # noqa: E402


class LineaPdfEffiTest(unittest.TestCase):
    def test_formato_con_columna_de_iva_en_porcentaje(self):
        m = effitron.LINEA_PDF.match('1 A200FUT01 UNIFORME FUTBOL 3 $57,983.19 $0 19% $33,050.42 $206,999.99')
        self.assertIsNotNone(m)
        self.assertEqual(m.group(2), 'A200FUT01')
        self.assertEqual(m.group(5), '57,983.19')
        self.assertEqual(effitron._dinero(m.group(5)), 57983.19)

    def test_segunda_linea_del_remision_7751(self):
        m = effitron.LINEA_PDF.match('2 A200-7200V UNIFORME VOLEIBOL FEMENINO 4 $66,386.55 $0 19% $50,453.78 $315,999.98')
        self.assertIsNotNone(m)
        self.assertEqual(m.group(5), '66,386.55')

    def test_dinero_con_decimales_y_formato_antiguo(self):
        self.assertEqual(effitron._dinero('57,983.19'), 57983.19)
        self.assertEqual(effitron._dinero('$33,050.42'), 33050.42)
        self.assertEqual(effitron._dinero('65.000'), 65000.0)
        self.assertEqual(effitron._dinero('$206.999'), 206999.0)
        self.assertEqual(effitron._dinero('$0'), 0.0)

    def test_formato_antiguo_sigue_funcionando(self):
        m = effitron.LINEA_PDF.match('1 A100FUT01 UNIFORME FUTBOL 2 $65,000.00 $0 $12,350.00 $142,350.00')
        self.assertIsNotNone(m)
        self.assertEqual(m.group(5), '65,000.00')


if __name__ == '__main__':
    unittest.main()
