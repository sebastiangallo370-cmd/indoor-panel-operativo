import unittest

from app import inventario_api as inv

ENCABEZADO = ['', 'NOMBRE', 'R1', 'R2', 'R3', 'TOTAL']


class DonAlveiro(unittest.TestCase):
    def _registros(self, filas):
        return inv._records_for_tab([ENCABEZADO] + filas, 'BODEGA TELA', 'BODEGA TELA')

    def test_el_reporte_de_don_alveiro_no_aparece_en_el_inventario(self):
        filas = [
            ['', 'MONTECATINI BLANCO', '91', '91', '91', '273'],
            ['', '', '93', '90', '', '183'],   # línea sin nombre: pertenece a la tela de arriba
            ['', 'RIB NEGRO (DON ALVEIRO)', '52', '52', '46', '150'],
            ['', '(50) MONTECATINI 2 (DON ALVEIRO) DEL 2025', '91', '91', '91', '273'],
            ['', '', '93', '90', '91', '274'],   # línea sin nombre de DON ALVEIRO: tampoco debe sumarse a nada
            ['', 'LONDON', '60', '', '', '60'],
        ]
        nombres = [r['nombre'] for r in self._registros(filas)]
        self.assertEqual(nombres, ['MONTECATINI BLANCO', 'LONDON'])

    def test_las_lineas_sin_nombre_de_don_alveiro_no_se_suman_a_la_tela_de_arriba(self):
        filas = [
            ['', 'LONDON', '60', '', '', '60'],
            ['', '(50) MONTECATINI 2 (DON ALVEIRO)', '91', '91', '', '182'],
            ['', '', '93', '', '', '93'],
        ]
        r = self._registros(filas)
        self.assertEqual([x['nombre'] for x in r], ['LONDON'])
        self.assertEqual(r[0]['total'], 60)


if __name__ == '__main__':
    unittest.main()
