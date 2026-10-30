import unittest
from unittest.mock import patch

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

    def test_no_usa_ficha_tecnica_si_no_hay_materiales_en_maestro(self):
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
        self.assertEqual(resultado, [])

    def test_maestro_antiguo_tiene_prioridad_sobre_ficha_tecnica(self):
        maestros = {
            'CP07': {
                'ref': 'CP07',
                'masc': [1] * 8,
                'fem': [1] * 8,
                'nino': [0, 1, 1, 1, 1, 1, 1, 1],
                'nina': [0, 1, 1, 1, 1, 1, 1, 1],
            }
        }
        fichas = {
            'CP07': {
                'telas': [{'material': 'M1', 'tela': 'TRIATLÓN'}],
                'promedios': [{'nombre': 'PROMEDIO M1', 'valores': {'masc': '0.15'}}],
            }
        }
        resultado = tela_necesaria.calcular_materiales_por_talla(
            'A11400CP07', [{'genero': 'MASC', 'talla': 'M', 'cantidad': 36}], maestros, fichas
        )
        self.assertEqual([(m['codigo'], m['mts'], m['origen']) for m in resultado],
                         [('11400', 36.0, 'PROMEDIOS MAESTROS')])

    def test_no_reutiliza_listado_de_otra_fila_de_la_misma_referencia(self):
        datos = {
            'maestros': [{'ref': 'CP07', 'masc': [1] * 8, 'fem': [1] * 8,
                          'nino': [0, 1, 1, 1, 1, 1, 1, 1], 'nina': [0, 1, 1, 1, 1, 1, 1, 1]}],
            'plantillas': [],
        }
        filas = [
            {'source_row': 41, 'values': ['CO1', 'A11400CP07', '27']},
            {'source_row': 42, 'values': ['CO1', 'A11400CP07', '6']},
        ]
        listado = {'CO1': {'hojas': {'A11400CP07': [{'genero': 'MASC', 'talla': 'M', 'cantidad': 27}]}}}
        with patch.object(promedios, '_leer', return_value=datos), patch.dict(tela_necesaria._tallas, listado, clear=True):
            detalle = tela_necesaria.detalles_mts_produccion(filas, ['ORDEN', 'REFERENCIA', 'CANTIDAD'])
        self.assertEqual(detalle['41']['total'], 27.0)
        self.assertEqual(detalle['42']['total'], 6.0)

    def test_listado_incompleto_usa_promedio_maestro_completo(self):
        maestros = {
            'RP08': {
                'ref': 'RP08',
                'masc': [1] + [0] * 7,
                'fem': [0] * 8,
                'nino': [0] * 8,
                'nina': [0] * 8,
            }
        }
        resultado = tela_necesaria.calcular_materiales_por_talla(
            'A2100RP08', [
                {'genero': 'MASC', 'talla': 'XS', 'cantidad': 1},
                {'genero': 'MASC', 'talla': '2XL', 'cantidad': 35},
            ], maestros,
        )
        self.assertEqual([(m['codigo'], m['mts']) for m in resultado], [('2100', 36.0)])

    def test_tarjeta_expone_un_renglon_real_por_material(self):
        datos = {
            'maestros': [{
                'ref': 'FUT04',
                'materiales': [
                    {'material': 'M1', 'tela': 'MONTECATINI', 'masc': [0, 0, 0, 0, 1.5, 0, 0, 0], 'fem': [0] * 8, 'nina': [0] * 8, 'nino': [0] * 8},
                    {'material': 'M2', 'tela': 'TRIATLÓN', 'masc': [0, 0, 0, 0, 0.89, 0, 0, 0], 'fem': [0] * 8, 'nina': [0] * 8, 'nino': [0] * 8},
                ],
            }],
            'plantillas': [],
        }
        filas = [{'source_row': 21, 'values': ['CO1', 'A11300-1800FUT04', '2']}]
        with patch.object(promedios, '_leer', return_value=datos), patch.dict(
            tela_necesaria._tallas, {'CO1': {'hojas': {'A11300-1800FUT04': [{'genero': 'MASC', 'talla': 'XL', 'cantidad': 2}]}}}, clear=True
        ):
            detalle = tela_necesaria.detalles_mts_produccion(filas, ['ORDEN', 'REFERENCIA', 'CANTIDAD'])
        self.assertEqual(detalle['21']['total'], 4.78)
        self.assertEqual([(m['codigo'], m['mts']) for m in detalle['21']['materiales']], [('11300', 3.0), ('1800', 1.78)])

    def test_cb11_sin_maestro_no_usa_ficha_tecnica(self):
        ficha = {
            'ref': 'CB11',
            'telas': [
                {'material': 'M1', 'tela': 'MONTECATINI'},
                {'material': 'M1', 'tela': 'BRILHO DAVOS CUADROS'},
                {'material': 'M2', 'tela': 'TRIATHLON'},
            ],
            'promedios': [
                {'nombre': 'PROMEDIO M1', 'valores': {'masc': '0.61', 'feme': '0.52', 'nino': '0.38'}},
                {'nombre': 'PROMEDIO M2', 'valores': {'masc': '0.74', 'feme': '0.59', 'nino': '0.37'}},
            ],
        }
        datos = {'maestros': [], 'plantillas': []}
        filas = [{'source_row': 1646, 'values': ['CO6204', 'A100-11400CB11-1', '19']}]
        with patch.object(promedios, '_leer', return_value=datos), patch.dict(tela_necesaria._tallas, {}, clear=True):
            detalle = tela_necesaria.detalles_mts_produccion(
                filas, ['ORDEN', 'REFERENCIA', 'CANTIDAD'], ficha_resolver=lambda ref: ficha if ref == 'CB11' else None
            )
        self.assertNotIn('1646', detalle)


if __name__ == '__main__':
    unittest.main()
