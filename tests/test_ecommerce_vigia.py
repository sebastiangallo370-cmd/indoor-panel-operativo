"""El panel pregunta a la API de Effi por órdenes de venta nuevas y solo entonces despierta a ALMA."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import ecommerce_canal as ec
from app import effi_api


class Vigia(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.p = [mock.patch.object(ec, '_file', base / 'ecommerce.json'), mock.patch.object(ec, '_vigia_file', base / 'vigia.json'),
                  mock.patch.object(ec, '_llave_effi', lambda: 'K' * 40)]
        for m in self.p:
            m.start()
        d = ec._leer()
        d['latido'] = {'at': ec._ahora(), 'iso': ec._iso(), 'equipo': 'PC'}
        d['agentes']['alma'] = {'estado': 'CORRIENDO'}
        ec._guardar(d)

    def tearDown(self):
        effi_api.usar_llave('')
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def ordenes_de_revision(self):
        return [o for o in ec._leer()['ordenes'] if o['accion'] == 'revisar']

    def test_primera_vez_solo_toma_nota_y_luego_avisa_de_las_nuevas(self):
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': 10, 'sucursal': 1, 'vigente': '1', 'id_transaccion': 'PPAL-10'}]):
            self.assertEqual(ec.revisar_ordenes_venta(), [])          # base: lo que ya existía no despierta a ALMA
        self.assertFalse(self.ordenes_de_revision())
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': 11, 'sucursal': 1, 'vigente': '1', 'id_transaccion': 'PPAL-11'}, {'id': 10, 'sucursal': 1, 'vigente': '1'}]):
            self.assertEqual(ec.revisar_ordenes_venta(), ['1-11'])
        self.assertEqual(len(self.ordenes_de_revision()), 1)
        self.assertIn('Effi', self.ordenes_de_revision()[0]['por'])
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': 11, 'sucursal': 1, 'vigente': '1'}]):
            self.assertEqual(ec.revisar_ordenes_venta(), [])          # no repite el aviso

    def test_las_anuladas_no_despiertan_a_alma(self):
        with mock.patch.object(effi_api, '_lista', return_value=[]):
            ec.revisar_ordenes_venta()
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': 12, 'sucursal': 1, 'vigente': '0'}]):
            self.assertEqual(ec.revisar_ordenes_venta(), [])

    def test_sin_llave_no_consulta(self):
        with mock.patch.object(ec, '_llave_effi', lambda: ''), mock.patch.object(effi_api, '_lista') as consulta:
            self.assertEqual(ec.revisar_ordenes_venta(), [])
        consulta.assert_not_called()

    def test_si_alma_esta_apagada_no_encola(self):
        d = ec._leer()
        d['agentes']['alma'] = {'estado': 'INACTIVO'}
        ec._guardar(d)
        with mock.patch.object(effi_api, '_lista', return_value=[]):
            ec.revisar_ordenes_venta()
        with mock.patch.object(effi_api, '_lista', return_value=[{'id': 13, 'sucursal': 1, 'vigente': '1'}]):
            self.assertEqual(ec.revisar_ordenes_venta(), ['1-13'])
        self.assertFalse(self.ordenes_de_revision())


if __name__ == '__main__':
    unittest.main()
