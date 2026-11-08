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
            futbol.mkdir(parents=True)
            (futbol / 'FUT01_D1_GT.jpg').touch()
            (futbol / 'FUT01_D2_GT.JPG').touch()
            (futbol / 'FUT01_MUESTRA.jpg').touch()
            (futbol / 'FUT02_D1_.jpg').touch()
            (futbol / 'nota.pdf').touch()
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
