import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))

import sublimacion_stock as s  # noqa: E402


def tela(id_, nombre, rollos, estados=None):
    return {'id': id_, 'nombre': nombre, 'categoria': 'BODEGA TELA',
            'roll_values': rollos, 'roll_statuses': estados or ['new'] * len(rollos)}


def orden(num, t, mts, ref='R1'):
    return {'orden': num, 'tela': t, 'mts': mts, 'referencia': ref, 'fecha': ''}


class WholeMtsTest(unittest.TestCase):
    def test_enteros(self):
        self.assertEqual(s.whole_mts(0), 0)
        self.assertEqual(s.whole_mts(0.2), 1)
        self.assertEqual(s.whole_mts(10.4), 10)
        self.assertEqual(s.whole_mts(10.5), 11)


class PlanTest(unittest.TestCase):
    def test_empezados_primero_y_cubre(self):
        items = [tela(1, 'LYCRA BLANCO', [50, 20, 30], ['new', 'started', 'new'])]
        plan = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 35))])[0]
        self.assertEqual([r['value'] for r in plan['rolls']], [20, 30])
        self.assertFalse(plan['short'])

    def test_no_alcanza(self):
        items = [tela(1, 'LYCRA BLANCO', [10, 5])]
        plan = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 40))])[0]
        self.assertTrue(plan['short'])
        self.assertEqual(plan['missing'], 25.0)

    def test_rollos_no_se_repiten_entre_ordenes(self):
        items = [tela(1, 'LYCRA BLANCO', [30, 30])]
        planes = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 25)), (6, orden('OP2', 'LYCRA', 25))])
        usados = [(r['id'], r['index']) for p in planes for r in p['rolls']]
        self.assertEqual(len(usados), len(set(usados)))

    def test_excluye_don_alveiro_y_rib(self):
        items = [tela(1, 'LYCRA DON ALVEIRO', [100]), tela(2, 'LYCRA RIB', [100])]
        plan = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 10))])[0]
        self.assertEqual(plan['rolls'], [])

    def test_prefiere_blanco(self):
        items = [tela(1, 'LYCRA NEGRO', [100]), tela(2, 'LYCRA BLANCO', [100])]
        plan = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 10))])[0]
        self.assertEqual(plan['rolls'][0]['id'], 2)

    def test_misma_orden_y_tela_es_un_solo_plan(self):
        items = [tela(1, 'LYCRA BLANCO', [100])]
        planes = s.build_plan(items, [(5, orden('OP1', 'LYCRA', 10, 'A')), (6, orden('OP1', 'LYCRA', 15, 'B'))])
        self.assertEqual(len(planes), 1)
        self.assertEqual(planes[0]['mts'], 25)


class ConsumoTest(unittest.TestCase):
    def test_rollo_completo_si_cabe_y_sobrante_entero(self):
        plan = {'mts': 25, 'rolls': [{'item': 'X', 'value': 20}, {'item': 'X', 'value': 30}]}
        tomado = s._consume(plan)
        self.assertEqual([t['take'] for t in tomado], [20.0, 5.0])


if __name__ == '__main__':
    unittest.main()
