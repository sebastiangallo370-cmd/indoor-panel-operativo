"""RM7756: la plantilla de niño «D1 CA16N 4 A 16.ai» debe elegirse para las tallas 4-16 aunque Promedios maestros
solo nombre CA16M y CA16F (antes se descartaba y las tallas de niño nunca se exportaban)."""
import sys
import unittest
from pathlib import Path

CODIGO = Path(__file__).resolve().parents[1] / '_agentes_indoor_actualizado_20261028' / 'AGENTES_INDOOR' / 'codigo'
sys.path.insert(0, str(CODIGO))

from core import seleccion  # noqa: E402


def _linea(talla, genero='MASC'):
    return {'hoja': 'A100-500CA16', 'talla': talla, 'genero': genero, 'diseno': 'D1', 'nombre': '', 'numero': '1'}


class PlantillaNino(unittest.TestCase):
    def setUp(self):
        base = Path('X:/MAESTROS/UNIFORMES 2027/CA16_D1')
        self.rutas = [base / 'D1 CA16M XS A 4XL.ai', base / 'D1 CA16F XS A 4XL.ai', base / 'D1 CA16N 4 A 16.ai']

    def test_nino_se_elige_con_plantillas_de_adulto(self):
        sel, motivo = seleccion.mesas_para(self.rutas, [_linea('S'), _linea('8'), _linea('14')], plantillas=['CA16M', 'CA16F'])
        nombres = {p.name for p in sel}
        self.assertIn('D1 CA16N 4 A 16.ai', nombres, motivo)
        self.assertIn('D1 CA16M XS A 4XL.ai', nombres)

    def test_otra_referencia_no_se_cuela(self):
        rutas = self.rutas + [Path('X:/MAESTROS/CA04_D1/D1 CA04N 4 A 16.ai')]
        sel, _ = seleccion.mesas_para(rutas, [_linea('8')], plantillas=['CA16M', 'CA16F'])
        self.assertNotIn('D1 CA04N 4 A 16.ai', {p.name for p in sel})


if __name__ == '__main__':
    unittest.main()
