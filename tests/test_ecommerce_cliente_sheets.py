"""La programación de e-commerce usa la razón social sin perder el cliente real."""
import importlib.util
import unittest
from pathlib import Path
from unittest import mock


RAIZ = Path(__file__).resolve().parent.parent
ESPEC = importlib.util.spec_from_file_location('agente_ov_cliente_sheets', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
agente_ov = importlib.util.module_from_spec(ESPEC)
ESPEC.loader.exec_module(agente_ov)
ESPEC_PUENTE = importlib.util.spec_from_file_location('puente_ecommerce_cliente_sheets', RAIZ / 'ecommerce_pc' / 'puente_ecommerce.py')
puente_ecommerce = importlib.util.module_from_spec(ESPEC_PUENTE)
ESPEC_PUENTE.loader.exec_module(puente_ecommerce)


class MaestroFalso:
    def __init__(self, falla=False):
        self.falla = falla
        self.cliente_enviado = None

    def leer_encabezado(self, _pdf):
        return {'orden': '1234', 'cliente': 'Cliente real de Effi'}

    def registrar_en_sheets(self, pdf, _items):
        self.cliente_enviado = self.leer_encabezado(pdf)['cliente']
        if self.falla:
            raise RuntimeError('Sheets no disponible')
        return True


class ClienteEnSheets(unittest.TestCase):
    def test_programa_a_nombre_de_indoor_sport_y_restaura_el_cliente_real(self):
        maestro = MaestroFalso()

        with mock.patch.object(agente_ov, 'config', return_value={'programar_a_indoor_sport': True}):
            self.assertTrue(agente_ov.registrar_en_sheets_a_nombre_de_indoor_sport(maestro, 'OV_1234.pdf', []))

        self.assertEqual(maestro.cliente_enviado, 'INDOOR SPORT SAS')
        self.assertEqual(maestro.leer_encabezado('OV_1234.pdf')['cliente'], 'Cliente real de Effi')

    def test_restaura_el_lector_si_google_sheets_falla(self):
        maestro = MaestroFalso(falla=True)

        with mock.patch.object(agente_ov, 'config', return_value={'programar_a_indoor_sport': True}):
            with self.assertRaisesRegex(RuntimeError, 'Sheets no disponible'):
                agente_ov.registrar_en_sheets_a_nombre_de_indoor_sport(maestro, 'OV_1234.pdf', [])

        self.assertEqual(maestro.cliente_enviado, 'INDOOR SPORT SAS')
        self.assertEqual(maestro.leer_encabezado('OV_1234.pdf')['cliente'], 'Cliente real de Effi')

    def test_desactivado_conserva_el_cliente_real(self):
        maestro = MaestroFalso()

        with mock.patch.object(agente_ov, 'config', return_value={'programar_a_indoor_sport': False}):
            self.assertTrue(agente_ov.registrar_en_sheets_a_nombre_de_indoor_sport(maestro, 'OV_1234.pdf', []))

        self.assertEqual(maestro.cliente_enviado, 'Cliente real de Effi')

    def test_puente_guarda_el_interruptor_sin_perder_su_configuracion(self):
        configuracion = {'ruta_bots': 'D:/bots'}
        with mock.patch.object(puente_ecommerce, 'leer_json', return_value=configuracion), mock.patch.object(puente_ecommerce, 'guardar_json') as guardar:
            puente_ecommerce.aplicar_configuracion_del_panel({'programar_a_indoor_sport': True})

        datos = guardar.call_args.args[1]
        self.assertTrue(datos['programar_a_indoor_sport'])
        self.assertEqual(datos['ruta_bots'], 'D:/bots')


if __name__ == '__main__':
    unittest.main()
