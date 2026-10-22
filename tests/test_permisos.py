import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ['APP_USER'] = 'PRODUCCION'
os.environ['PERMISOS_FILE'] = str(Path(tempfile.mkdtemp()) / 'permisos.json')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))

import permisos  # noqa: E402

PROCESOS = {}
permisos.registrar_lookup(lambda u: PROCESOS.get(u))


def cuenta(nombre, proceso):
    PROCESOS[nombre] = proceso
    return nombre


class PermisosTest(unittest.TestCase):
    def test_roles(self):
        self.assertEqual(permisos.rol_de('PRODUCCION'), 'administracion')
        self.assertEqual(permisos.rol_de(cuenta('a', 'Coordinador')), 'administracion')
        self.assertEqual(permisos.rol_de(cuenta('b', 'Comercial')), 'comercial')
        self.assertEqual(permisos.rol_de(cuenta('c', 'Edición')), 'edicion')
        self.assertEqual(permisos.rol_de(cuenta('d', 'Sublimación')), 'operario')

    def test_agentes_solo_edicion_coordinador_y_maestra(self):
        self.assertTrue(permisos.agentes_permitido('PRODUCCION'))
        self.assertTrue(permisos.agentes_permitido(cuenta('e', 'Edición')))
        self.assertTrue(permisos.agentes_permitido(cuenta('f', 'Coordinador')))
        self.assertFalse(permisos.agentes_permitido(cuenta('g', 'Comercial')))
        self.assertFalse(permisos.agentes_permitido(cuenta('h', 'Empaque')))

    def test_info_tela_la_edita_patronaje(self):
        self.assertTrue(permisos.info_tela_editar_permitido(cuenta('pt', 'Patronaje')))
        self.assertTrue(permisos.info_tela_editar_permitido('PRODUCCION'))
        self.assertFalse(permisos.info_tela_editar_permitido(cuenta('em', 'Empaque')))
        self.assertTrue(permisos.puede(cuenta('em2', 'Empaque'), 'promedios', 'ver'))   # los demás operarios siguen viéndola sin editar

    def test_tesoreria_comercial_y_indoor_sport(self):
        self.assertTrue(permisos.tesoreria_permitido(cuenta('i', 'Comercial')))
        self.assertTrue(permisos.tesoreria_permitido('Indoor Sport'))
        self.assertFalse(permisos.tesoreria_permitido(cuenta('j', 'Edición')))
        self.assertFalse(permisos.tesoreria_permitido(cuenta('k', 'Empaque')))

    def test_cartera_bloqueada_para_edicion_y_operario(self):
        self.assertFalse(permisos.puede(cuenta('l', 'Edición'), 'cartera', 'ver'))
        self.assertFalse(permisos.puede(cuenta('m', 'Empaque'), 'cartera', 'ver'))
        self.assertTrue(permisos.puede(cuenta('n', 'Comercial'), 'cartera', 'ver'))

    def test_administracion_siempre_con_todo(self):
        m = permisos.matriz()
        for modulo, (_, acciones) in permisos.MODULOS.items():
            for a in acciones:
                self.assertTrue(m['administracion'][modulo][a])


if __name__ == '__main__':
    unittest.main()
