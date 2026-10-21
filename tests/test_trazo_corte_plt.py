import unittest

from app import trazo_plt


class TrazoCortePltTest(unittest.TestCase):
    def test_tela_blanca_no_aplica(self):
        self.assertFalse(trazo_plt.aplica_trazo('A200CA01'))
        self.assertFalse(trazo_plt.aplica_trazo('A100CA02'))
        self.assertFalse(trazo_plt.aplica_trazo('A11200CA02-A11200PT01'))

    def test_tela_de_color_si_aplica(self):
        self.assertTrue(trazo_plt.aplica_trazo('A2102SD02'))
        self.assertTrue(trazo_plt.aplica_trazo('A7202SHT01'))
        self.assertFalse(trazo_plt.aplica_trazo('A700CA00'))   # la regla es por el código de tela: 700 termina en 00

    def test_varias_partes_alguna_de_color(self):
        self.assertTrue(trazo_plt.aplica_trazo('A100CB02-A2102PT01'))

    def test_sin_codigo_no_aplica(self):
        self.assertFalse(trazo_plt.aplica_trazo(''))
        self.assertFalse(trazo_plt.aplica_trazo('A-TELAUCO-CA02'))

    def test_celdas_vacias_pasan_a_na_solo_si_no_aplica(self):
        headers = ['REFERENCIA', 'TRAZO', 'CORTE TEXTIL/PLT', 'RESP.', 'ESTADO']
        base = {'headers': headers, 'rows': [
            {'source_row': 1, 'values': ['A200CA01', '', '', '', '']},
            {'source_row': 2, 'values': ['A2102SD02', '', '', '', '']},
            {'source_row': 3, 'values': ['A200CA01', 'P', '', '', '']},
        ]}
        trazo_plt.marcar_no_aplica(base, lambda h: trazo_plt.ETIQUETA if h in ('TRAZO', 'CORTE TEXTIL/PLT') else '')
        self.assertEqual(base['rows'][0]['values'][1:3], ['N/A', 'N/A'])
        self.assertEqual(base['rows'][1]['values'][1:3], ['', ''])
        self.assertEqual(base['rows'][2]['values'][1:3], ['N/A', 'N/A'])


    def test_pedido_entregado_no_queda_en_la_cola(self):
        headers = ['REFERENCIA', 'TRAZO', 'CORTE TEXTIL/PLT', 'ENTREGADO']
        fecha = lambda t: t[:2].isdigit() and '-' in t and len(t) >= 8
        base = {'headers': headers, 'rows': [
            {'source_row': 1, 'values': ['CAMISETA POLO', '´26-06', '22-07-2026', '05-08-2026']},   # nota vieja + fecha, entregado
            {'source_row': 2, 'values': ['A2102PT12', 'P', '', '10-10-2026']},                      # entregado con «P» olvidada
            {'source_row': 3, 'values': ['A2102PT12', 'P', '', '']},                               # sin entregar: se respeta
        ]}
        trazo_plt.marcar_no_aplica(base, lambda h: trazo_plt.ETIQUETA if h != 'REFERENCIA' and h != 'ENTREGADO' else '', fecha)
        self.assertEqual(base['rows'][0]['values'][1:3], ['N/A', '22-07-2026'])
        self.assertEqual(base['rows'][1]['values'][1:3], ['N/A', 'N/A'])
        self.assertEqual(base['rows'][2]['values'][1:3], ['P', ''])


if __name__ == '__main__':
    unittest.main()
