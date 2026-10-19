import unittest

from app import inventario_api as inv


class RollosDeTela(unittest.TestCase):
    def test_un_numero_antes_del_nombre_no_es_un_rollo(self):
        """QATAR: la columna A traía 6723 (una anotación) y se sumaba como rollo → «Bodega 7.244» en vez de 521."""
        values = [['', 'NOMBRE TELA', 'R1', 'R2', 'R3', 'TOTAL'],
                  ['6723', '(11200) QATAR (SUDAFRICA)', '24', '111', '56', '191']]
        rec = inv._records_for_tab(values, 'BODEGA TELA', 'Bodega tela', None)[0]
        self.assertEqual(rec['roll_values'], [24.0, 111.0, 56.0])
        self.assertEqual(rec['total'], 191.0)

    def test_un_numero_despues_del_total_no_es_un_rollo(self):
        values = [['', 'NOMBRE TELA', 'R1', 'R2', 'TOTAL', 'NOTA'],
                  ['', '(1) TELA X', '10', '20', '30', '999']]
        self.assertEqual(inv._records_for_tab(values, 'BODEGA TELA', 'Bodega tela', None)[0]['roll_values'], [10.0, 20.0])


if __name__ == '__main__':
    unittest.main()


class TotalDeLaHoja(unittest.TestCase):
    def test_total_con_formula_incompleta_manda_la_suma_de_rollos(self):
        values = [['', 'NOMBRE TELA', 'R1', 'R2', 'R3', 'TOTAL'],
                  ['', '(200) DIAMANTE BLANCO', '108', '43', '100', '251'],
                  ['', '', '106', '106', '107', '300']]
        rec = inv._records_for_tab(values, 'BODEGA TELA', 'Bodega tela', None)[0]
        self.assertEqual(rec['roll_values'], [108.0, 43.0, 100.0, 106.0, 106.0, 107.0])
        self.assertEqual(rec['total'], 570.0)
        self.assertEqual(rec['total_sheet'], 551.0)   # 251 + 300 (lo que decía el Sheet)
