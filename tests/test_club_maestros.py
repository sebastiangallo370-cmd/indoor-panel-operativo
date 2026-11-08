import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import club


class ClubMaestrosTests(unittest.TestCase):
    def test_solo_cuenta_jpg_con_referencia_diseno_maquina(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            maestros = Path(tmp) / 'CLIENTES' / 'CERROS' / 'MAESTROS'
            futbol = maestros / 'UNIFORMES 2027 FUTBOL'
            referencia = futbol / 'FUT01_D1_D2_PLUS'
            referencia.mkdir(parents=True)
            (referencia / 'FUT01_D1_GT.jpg').touch()
            (referencia / 'FUT01_D2_GT.JPG').touch()
            (referencia / 'FUT01_MUESTRA.jpg').touch()
            (referencia / 'FUT02_D1_.jpg').touch()
            (referencia / 'nota.pdf').touch()
            (maestros / 'RECURSOS').mkdir()
            with patch.object(club, '_clientes_root', return_value=str(Path(tmp) / 'CLIENTES')):
                proyectos = club.proyectos_maestros_de('cerros')

        self.assertEqual(proyectos, [{
            'proyecto': 'UNIFORMES 2027 FUTBOL',
            'referencias': ['FUT01'],
            'disenos': 2,
        }])


if __name__ == '__main__':
    unittest.main()
