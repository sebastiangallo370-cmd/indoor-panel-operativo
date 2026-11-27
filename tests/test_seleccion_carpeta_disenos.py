"""Las mesas del maestro se eligen solo por los diseños del listado, y una copia mal ubicada no se usa.

Caso real (orden RM7755, CA04): «D1 CA04N 4 A 16.ai» existe en CA04_D1_D2 y también en CA04_D7_D8.
Antes se exportaban las dos (12 trabajos, con diseños 7 y 8 aunque el listado solo pedía 1 a 5).
"""
import sys
import unittest
from pathlib import Path

CODIGO = Path(__file__).resolve().parents[1] / "_agentes_indoor_actualizado_20261028" / "AGENTES_INDOOR" / "codigo"
sys.path.insert(0, str(CODIGO))

from core import seleccion  # noqa: E402


def _linea(diseno, genero, talla, hoja="A11400CA04"):
    return {"diseno": f"DISEÑO {diseno}", "genero": genero, "talla": talla, "hoja": hoja}


class SeleccionCarpetaDisenosTest(unittest.TestCase):
    def test_disenos_de_carpeta(self):
        self.assertEqual(seleccion._disenos_de_carpeta("CA04_D7_D8"), {7, 8})
        self.assertEqual(seleccion._disenos_de_carpeta("CA04_D1_D2"), {1, 2})
        self.assertEqual(seleccion._disenos_de_carpeta("CA16MFN_D1_NEGRO"), {1})
        self.assertEqual(seleccion._disenos_de_carpeta("PE01MFN"), set())

    def test_copia_en_carpeta_de_otros_disenos_no_se_exporta(self):
        rutas = [
            Path("CA04_D1_D2/D1 CA04N 4 A 16.ai"),
            Path("CA04_D7_D8/D1 CA04N 4 A 16.ai"),
        ]
        lineas = [_linea(1, "NIÑO", "10")]
        sel, _ = seleccion.mesas_para(rutas, lineas)
        self.assertEqual(sel, [Path("CA04_D1_D2/D1 CA04N 4 A 16.ai")])

    def test_no_duplica_la_misma_mesa(self):
        rutas = [
            Path("CA04_D1_D2/D1 CA04M XS A 4XL.ai"),
            Path("OTRA/D1 CA04M XS A 4XL.ai"),
        ]
        lineas = [_linea(1, "MASC", "S"), _linea(1, "MASC", "M")]
        sel, _ = seleccion.mesas_para(rutas, lineas)
        self.assertEqual(len(sel), 1)

    def test_solo_los_disenos_del_listado(self):
        rutas = [
            Path("CA04_D1_D2/D1 CA04M XS A 4XL.ai"),
            Path("CA04_D7_D8/D7 CA04M XS A 4XL.ai"),
            Path("CA04_D7_D8/D8 CA04M XS A 4XL.ai"),
        ]
        lineas = [_linea(1, "MASC", "S"), _linea(7, "MASC", "S")]
        sel, _ = seleccion.mesas_para(rutas, lineas)
        self.assertEqual(sorted(p.name for p in sel), ["D1 CA04M XS A 4XL.ai", "D7 CA04M XS A 4XL.ai"])


if __name__ == "__main__":
    unittest.main()
