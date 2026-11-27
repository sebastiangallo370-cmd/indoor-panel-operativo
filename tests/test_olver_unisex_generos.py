"""Un maestro unisex («D1 CA42 XS A 5XL.ai») con FEM y MASC en el listado se procesa una vez por género.

Caso real: orden CO6465 (FEM×6, MASC×52 en D1). Antes fallaba con «necesita un único género».
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

CODIGO = Path(__file__).resolve().parents[1] / "_agentes_indoor_actualizado_20261028" / "AGENTES_INDOOR" / "codigo"
sys.path.insert(0, str(CODIGO))

from agents import olver  # noqa: E402


def _linea(genero, talla):
    return {"genero": genero, "talla": talla, "diseno": "DISEÑO 1", "hoja": "A100CA42", "nombre": "", "numero": ""}


class UnisexVariosGenerosTest(unittest.TestCase):
    def test_se_procesa_por_cada_genero(self):
        llamadas = []

        def fake(ruta_ai, lineas, limpiar=True, **kw):
            llamadas.append((sorted({olver.seleccion._genero_efectivo(l) for l in lineas}), limpiar))
            return {"ok": True, "pdfs": [{"g": olver.seleccion._genero_efectivo(l)} for l in lineas], "carpeta": "x"}

        lineas = [_linea("FEMENINO", "M")] * 2 + [_linea("MASCULINO", "L")] * 3
        r = olver._por_genero_si_hace_falta(fake, ("D1 CA42 XS A 5XL.ai",), {"lineas": lineas, "limpiar": True})
        self.assertTrue(r["ok"])
        self.assertEqual(len(r["pdfs"]), 5)
        self.assertEqual(sorted(x[0][0] for x in llamadas), ["F", "M"])
        self.assertEqual([x[1] for x in llamadas].count(False), 1)   # solo la primera vez limpia

    def test_un_solo_genero_no_cambia_nada(self):
        def fake(ruta_ai, lineas, **kw):
            return {"ok": True, "pdfs": [1] * len(lineas)}

        lineas = [_linea("MASCULINO", "L")]
        r = olver._por_genero_si_hace_falta(fake, ("D1 CA42 XS A 5XL.ai",), {"lineas": lineas})
        self.assertEqual(r["pdfs"], [1])

    def test_error_de_un_genero_se_devuelve(self):
        def fake(ruta_ai, lineas, **kw):
            g = olver.seleccion._genero_efectivo(lineas[0])
            return {"ok": g != "F", "error": "falla F"} if g == "F" else {"ok": True, "pdfs": [1]}

        lineas = [_linea("FEMENINO", "M"), _linea("MASCULINO", "L")]
        r = olver._por_genero_si_hace_falta(fake, ("D1 CA42 XS A 5XL.ai",), {"lineas": lineas})
        self.assertFalse(r["ok"])

    def test_con_permitir_se_omite_el_genero_sin_plantilla(self):
        def fake(ruta_ai, lineas, permitir_faltantes=False, **kw):
            g = olver.seleccion._genero_efectivo(lineas[0])
            if g == "F" and not permitir_faltantes:
                return {"ok": False, "error": "sin plantilla F"}
            if g == "F":
                return {"ok": False, "error": "sin plantilla F"}
            return {"ok": True, "pdfs": [1] * len(lineas)}

        lineas = [_linea("FEMENINO", "M"), _linea("MASCULINO", "L"), _linea("MASCULINO", "XL")]
        r = olver._por_genero_si_hace_falta(fake, ("D1 CA42 XS A 5XL.ai",), {"lineas": lineas, "permitir_faltantes": True})
        self.assertTrue(r["ok"])
        self.assertEqual(r["omitidos_genero"], ["F"])
        self.assertEqual(len(r["pdfs"]), 2)


if __name__ == "__main__":
    unittest.main()
