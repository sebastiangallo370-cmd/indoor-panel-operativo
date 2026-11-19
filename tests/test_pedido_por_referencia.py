import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))

import listado_pedido  # noqa: E402
import sheet_pedidos  # noqa: E402


DOC = {'vendedor': 'Dayana Herrera', 'cliente': {'nombre': 'CLIENTE PRUEBA', 'correo': ''}, 'proyecto': 'PROYECTO DEL DOC', 'fecha_entrega': '2026-12-01'}


class PedidoPorReferencia(unittest.TestCase):
    def test_cada_referencia_lleva_su_aplique_proyecto_y_linea(self):
        grupos = [
            {'referencia': 'A100FUT02', 'cantidad': 3, 'proyecto': 'INDOOR 2026 2', 'linea': 'MAQUILA', 'textura': 'NO', 'tipos': []},
            {'referencia': 'A100FUT01', 'cantidad': 2, 'proyecto': 'PRESENTACION 2026', 'linea': 'PREMIUM', 'textura': 'SI', 'tipos': ['BORDADO', 'DTF/VINILO']},
        ]
        filas = sheet_pedidos.filas_del_pedido('CO1000', {'doc': DOC, 'linea': 'ESTANDAR', 'textura': 'SI', 'tipos': ['SELLO PRESTIGIO']}, grupos)
        self.assertEqual(filas[0][0], 'MAQUILA')
        self.assertEqual(filas[0][2], 'INDOOR 2026 2')
        self.assertEqual(filas[0][13], 'NO')
        self.assertEqual(filas[1][0], 'PREMIUM')
        self.assertEqual(filas[1][2], 'PRESENTACION 2026')
        self.assertEqual(filas[1][13], 'SI')

    def test_sin_datos_por_referencia_usa_los_del_documento(self):
        grupos = [{'referencia': 'A100FUT02', 'cantidad': 1}]
        filas = sheet_pedidos.filas_del_pedido('CO1000', {'doc': DOC, 'linea': 'plus', 'textura': 'SI', 'tipos': ['bordado']}, grupos)
        self.assertEqual(filas[0][0], 'PLUS')
        self.assertEqual(filas[0][2], 'PROYECTO DEL DOC')
        self.assertEqual(filas[0][13], 'SI')

    def test_textura_sin_tipos_no_inventa_texto(self):
        self.assertEqual(sheet_pedidos._textura_texto('SI', []), 'SI')
        self.assertEqual(sheet_pedidos._textura_texto('SI', ['BORDADO']), 'SI')
        self.assertEqual(sheet_pedidos._textura_texto('no', ['BORDADO']), 'NO')
        self.assertEqual(sheet_pedidos._textura_texto('', None), '')

    def test_hoja_del_excel_conserva_proyecto_y_linea_de_su_referencia(self):
        grupos = [
            {'referencia': 'A100FUT02', 'cantidad': 1, 'filas': [], 'proyecto': 'INDOOR 2026 2', 'linea': 'MAQUILA'},
            {'referencia': 'A100FUT01', 'cantidad': 1, 'filas': [], 'proyecto': 'PRESENTACION 2026', 'linea': 'PREMIUM'},
        ]
        hojas = listado_pedido.hojas_por_familia(grupos)
        self.assertEqual([(h['proyecto'], h['linea']) for h in hojas], [('INDOOR 2026 2', 'MAQUILA'), ('PRESENTACION 2026', 'PREMIUM')])


if __name__ == '__main__':
    unittest.main()
