import unittest

from app import promedios, tela_necesaria


class ReferenciasMultimaterialTest(unittest.TestCase):
    def test_no_separa_los_codigos_de_dos_telas(self):
        self.assertEqual(promedios.partes_de_hoja('A11300-1800FUT04'), ['FUT04'])
        self.assertEqual(tela_necesaria.codigos_de_materiales('A11300-1800FUT04'), ['11300', '1800'])

    def test_separa_referencias_compuestas(self):
        self.assertEqual(promedios.partes_de_hoja('A100CB02-A100PT01'), ['CB02', 'PT01'])

    def test_calcula_cada_material_por_talla(self):
        maestros = {
            'FUT04': {
                'ref': 'FUT04',
                'materiales': [
                    {'material': 'M1', 'tela': 'MONTECATINI', 'masc': [0, 0, 0, 0, 1.5, 0, 0, 0], 'fem': [0] * 8, 'nina': [0] * 8, 'nino': [0] * 8},
                    {'material': 'M2', 'tela': 'TRIATLÓN', 'masc': [0, 0, 0, 0, 0.89, 0, 0, 0], 'fem': [0] * 8, 'nina': [0] * 8, 'nino': [0] * 8},
                ],
            }
        }
        resultado = tela_necesaria.calcular_materiales_por_talla(
            'A11300-1800FUT04', [{'genero': 'MASC', 'talla': 'XL', 'cantidad': 2}], maestros
        )
        self.assertEqual([(m['codigo'], m['mts']) for m in resultado], [('11300', 3.0), ('1800', 1.78)])

    def test_usa_ficha_tecnica_si_no_hay_materiales_en_maestro(self):
        fichas = {
            'FUT04': {
                'telas': [{'material': 'M1', 'tela': 'MONTECATINI'}, {'material': 'M2', 'tela': 'TRIATLÓN'}],
                'promedios': [
                    {'nombre': 'PROMEDIO M1', 'valores': {'masc': [1.5]}},
                    {'nombre': 'PROMEDIO M2', 'valores': {'masc': [0.5]}},
                ],
            }
        }
        resultado = tela_necesaria.reparto_materiales('A11300-1800FUT04', {}, fichas, 20)
        self.assertEqual([(m['codigo'], m['mts']) for m in resultado], [('11300', 15.0), ('1800', 5.0)])


if __name__ == '__main__':
    unittest.main()
