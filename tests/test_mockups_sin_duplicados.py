"""Un mismo mockup no se guarda dos veces en MAESTROS aunque cambie de nombre."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import pedido_effi  # noqa: E402


class MismoContenidoTest(unittest.TestCase):
    def test_detecta_el_mismo_archivo_con_otro_nombre(self):
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            (carpeta / 'FUT02_D2_EPSON_JESAM.jpg').write_bytes(b'mockup-uno')
            self.assertTrue(pedido_effi._mismo_contenido_en(carpeta, b'mockup-uno'))
            self.assertFalse(pedido_effi._mismo_contenido_en(carpeta, b'mockup-dos'))

    def test_galeria_no_repite_el_mismo_mockup(self):
        with tempfile.TemporaryDirectory() as tmp:
            proy = Path(tmp)
            (proy / 'FUT02').mkdir()
            (proy / 'FUT02' / 'FUT02_D1.jpg').write_bytes(b'igual')
            (proy / 'FUT02' / 'FUT02_D2_COPIA.jpg').write_bytes(b'igual')
            (proy / 'FUT02' / 'FUT02_D3.jpg').write_bytes(b'otro')
            items = [{'ref': 'FUT02', 'carpeta': 'FUT02', 'archivo': 'FUT02_D1.jpg'},
                     {'ref': 'FUT02', 'carpeta': 'FUT02', 'archivo': 'FUT02_D2_COPIA.jpg'},
                     {'ref': 'FUT02', 'carpeta': 'FUT02', 'archivo': 'FUT02_D3.jpg'}]
            salida = pedido_effi._sin_repetidos(items, proy)
            self.assertEqual([i['archivo'] for i in salida], ['FUT02_D1.jpg', 'FUT02_D3.jpg'])

    def test_mismo_contenido_con_referencia_escrita_distinta(self):
        with tempfile.TemporaryDirectory() as tmp:
            proy = Path(tmp)
            (proy / 'A100FUT02').mkdir()
            (proy / 'FUT02').mkdir()
            (proy / 'A100FUT02' / 'A100FUT02_D1.jpg').write_bytes(b'mismo')
            (proy / 'FUT02' / 'FUT02_D1_EPSON JESAM.jpg').write_bytes(b'mismo')
            items = [{'ref': 'A100FUT02', 'carpeta': 'A100FUT02', 'archivo': 'A100FUT02_D1.jpg'},
                     {'ref': 'FUT02', 'carpeta': 'FUT02', 'archivo': 'FUT02_D1_EPSON JESAM.jpg'}]
            self.assertEqual(len(pedido_effi._sin_repetidos(items, proy)), 1)

    def test_carpeta_inexistente(self):
        self.assertFalse(pedido_effi._mismo_contenido_en(Path('/no/existe/nunca'), b'x'))


if __name__ == '__main__':
    unittest.main()
