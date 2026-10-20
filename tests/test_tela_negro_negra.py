import unittest

from app import sublimacion_stock as ss


def _item(nombre):
    return {'id': 1, 'nombre': nombre, 'categoria': 'BODEGA TELA', 'roll_values': [10, 27]}


class TelaNegroNegraTest(unittest.TestCase):
    def test_negro_encuentra_negra_con_numero(self):
        items = [_item('(7202) POLILICRA PESADA 972 NEGRA')]
        self.assertEqual(len(ss._matched(items, 'POLILICRA PESADA NEGRO')), 1)

    def test_no_mezcla_otro_color(self):
        items = [_item('(7203) POLILICRA PESADA 972 AZUL')]
        self.assertEqual(ss._matched(items, 'POLILICRA PESADA NEGRO'), [])

    def test_exacto_sigue_igual(self):
        items = [_item('(100) MONTECATINI BLANCO')]
        self.assertEqual(len(ss._matched(items, 'MONTECATINI BLANCO')), 1)


if __name__ == '__main__':
    unittest.main()
