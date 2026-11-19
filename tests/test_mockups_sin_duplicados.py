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

    def test_carpeta_inexistente(self):
        self.assertFalse(pedido_effi._mismo_contenido_en(Path('/no/existe/nunca'), b'x'))


if __name__ == '__main__':
    unittest.main()
