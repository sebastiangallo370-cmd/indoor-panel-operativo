import unittest

from app import tela_necesaria


class RepartoMaterialesTest(unittest.TestCase):
    def test_reparte_los_mts_entre_las_dos_telas(self):
        maestro = {'ref': 'FUT04', 'materiales': [
            {'material': 'M1', 'tela': 'MONTECATINI', 'masc': [0.9, 0.9], 'nino': [0.0, 0.9]},
            {'material': 'M2', 'tela': 'TRIATLHON', 'masc': [0.6, 0.6], 'nino': [0.0, 0.6]}]}
        r = tela_necesaria.reparto_materiales('FUT04', {'FUT04': maestro}, {}, 150.0)
        self.assertEqual([(x['material'], x['mts']) for x in r], [('M1', 90.0), ('M2', 60.0)])

    def test_sin_materiales_no_reparte(self):
        self.assertEqual(tela_necesaria.reparto_materiales('PE14', {'PE14': {'ref': 'PE14'}}, {}, 100.0), [])


if __name__ == '__main__':
    unittest.main()
