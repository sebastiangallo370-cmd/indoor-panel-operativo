"""AGENTE INVENTARIO: lo ven Administración/Coordinación y la cuenta SS (Stiven Sánchez); los demás no."""
import unittest
from unittest import mock

from fastapi import HTTPException

from app import permisos, zeus


class Acceso(unittest.TestCase):
    def procesos(self, mapa):
        return mock.patch.object(permisos, '_lookup', lambda u: mapa.get(u, ''))

    def test_ss_si_aunque_sea_de_patronaje(self):
        with self.procesos({'SS': 'PATRONAJE'}):
            self.assertTrue(permisos.zeus_permitido('SS'))
            self.assertTrue(permisos.zeus_permitido('ss'))

    def test_administracion_y_coordinador_siguen_viendolo(self):
        with self.procesos({'AD': 'ADMINISTRACION', 'CO': 'COORDINADOR'}):
            self.assertTrue(permisos.zeus_permitido('AD'))
            self.assertTrue(permisos.zeus_permitido('CO'))

    def test_otros_no(self):
        with self.procesos({'AP': 'PATRONAJE', 'XX': 'COMERCIAL'}):
            self.assertFalse(permisos.zeus_permitido('AP'))
            self.assertFalse(permisos.zeus_permitido('XX'))
            self.assertFalse(permisos.zeus_permitido(''))

    def test_la_ruta_mi_responde_403_a_quien_no_puede(self):
        with mock.patch.object(zeus, '_auth', lambda request: 'AP'), mock.patch.object(zeus, '_permitido', permisos.zeus_permitido), self.procesos({'AP': 'PATRONAJE'}):
            with self.assertRaises(HTTPException) as e:
                zeus.mi_acceso(None)
            self.assertEqual(e.exception.status_code, 403)

    def test_la_ruta_mi_responde_ok_a_ss(self):
        with mock.patch.object(zeus, '_auth', lambda request: 'SS'), mock.patch.object(zeus, '_permitido', permisos.zeus_permitido), self.procesos({'SS': 'PATRONAJE'}):
            self.assertEqual(zeus.mi_acceso(None), {'ok': True})


if __name__ == '__main__':
    unittest.main()
