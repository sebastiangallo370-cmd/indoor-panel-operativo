import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import club


class ClubMaestrosTests(unittest.TestCase):
    def test_reconoce_sufijo_fc_de_la_carpeta_del_club(self):
        self.assertTrue(club._mismo_cliente('CORPORACION SOCIOCULTURAL CERROS FC', 'CORPORACION SOCIOCULTURAL CERROS'))
        self.assertTrue(club._mismo_cliente('Corporación Sociocultural Cerros', 'CORPORACION SOCIOCULTURAL CERROS FC'))
        self.assertFalse(club._mismo_cliente('CORPORACION SOCIOCULTURAL CERROS FC', 'CORPORACION SOMOS AWARE'))

    def test_prefiere_fecha_real_antes_que_numero_de_fila(self):
        self.assertGreater(club._recencia('6-nov-2026', 2203), club._recencia('21-oct-2026', 2222))

    def test_reintento_remapea_maestro_sintetico_a_orden_real(self):
        pedido = {'id': 19, 'cliente': 'CERROS FC', 'lineas': [{
            'row': -44, 'referencia': 'FUT02', 'proyecto': 'UNIFORMES',
            'orden_base': 'MAESTRO', 'maestro_nas': True, 'jugadores': [],
        }]}
        db = MagicMock()
        conexion = MagicMock()
        conexion.__enter__.return_value = db
        with patch.object(club, '_pedido', return_value=pedido), \
             patch.object(club, 'proyectos_maestros_de', return_value=[]), \
             patch.object(club, 'disenos_de', return_value=[{
                 'row': 2203, 'referencia': 'A11200FUT02', 'maestro': 'FUT02',
                 'proyecto': 'UNIFORMES', 'orden': 'CO6330',
             }]), \
             patch.object(club, 'tela_de', return_value=('QATAR', '11200')), \
             patch.object(club, '_connect', return_value=conexion):
            actualizado = club.actualizar_maestros_pedido(19)

        linea = actualizado['lineas'][0]
        self.assertEqual(linea['row'], 2203)
        self.assertEqual(linea['referencia'], 'A11200FUT02')
        self.assertEqual(linea['orden_base'], 'CO6330')
        self.assertEqual(linea['tela'], 'QATAR')
        self.assertTrue(linea['maestro_nas'])
        db.execute.assert_called_once()

    def test_solo_cuenta_carpetas_de_referencia_diseno_maquina(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            maestros = Path(tmp) / 'CLIENTES' / 'CERROS' / 'MAESTROS'
            futbol = maestros / 'UNIFORMES 2027 FUTBOL'
            referencia = futbol / 'FUT01_D1_D2_PLUS'
            referencia.mkdir(parents=True)
            (futbol / 'RECURSOS').mkdir()
            (futbol / 'PE01_D1_D2_').mkdir()
            (maestros / 'RECURSOS').mkdir()
            with patch.object(club, '_clientes_root', return_value=str(Path(tmp) / 'CLIENTES')):
                proyectos = club.proyectos_maestros_de('cerros')

        self.assertEqual(proyectos, [{
            'proyecto': 'UNIFORMES 2027 FUTBOL',
            'referencias': ['FUT01', 'PE01'],
            'disenos': 4,
        }])


if __name__ == '__main__':
    unittest.main()
