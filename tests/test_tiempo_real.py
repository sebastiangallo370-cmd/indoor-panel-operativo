import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import proveedores_tela, tiempo_real


class TiempoRealTest(unittest.TestCase):
    def test_guardar_en_informacion_tela_avisa_a_los_agentes(self):
        avisos = []
        with tempfile.TemporaryDirectory() as d, mock.patch.object(proveedores_tela, '_file', Path(d) / 'pt.json'), \
                mock.patch.object(tiempo_real, '_suscritos', [lambda motivo: avisos.append(motivo)]):
            proveedores_tela.guardar({'codigo': '11200', 'id_effi': '6723'}, object())
        self.assertEqual(avisos, ['info_tela'])

    def test_un_agente_que_falla_no_impide_avisar_a_los_demas(self):
        vistos = []

        def malo(m):
            raise RuntimeError('x')
        with mock.patch.object(tiempo_real, '_suscritos', [malo, lambda m: vistos.append(m)]):
            tiempo_real.avisar('inventario')
        self.assertEqual(vistos, ['inventario'])


if __name__ == '__main__':
    unittest.main()
