"""La memoria de los agentes: huellas estables, errores corregidos que vuelven = regresión, lecciones iniciales."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import memoria_agentes as mem


class Memoria(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.p = [mock.patch.object(mem, '_file', Path(self.dir.name) / 'memoria.json'), mock.patch.object(mem, '_cache', None)]
        for m in self.p:
            m.start()

    def tearDown(self):
        for m in self.p:
            m.stop()
        self.dir.cleanup()

    def test_misma_huella_con_otros_numeros_y_rutas(self):
        a = mem.huella(r'No pude abrir C:\Users\Ana\orden RM7653\listado.xlsx (intento 3)')
        b = mem.huella(r'No pude abrir C:\Users\Luis\orden CO6128\listado.xlsx (intento 12)')
        self.assertEqual(a, b)
        self.assertNotEqual(a, mem.huella('Otro error distinto'))

    def test_error_corregido_que_vuelve_es_regresion(self):
        mem.registrar('OLVER', 'Falló la exportación de la mesa 3 de RM7001')
        d = mem._cargar()
        iid = next(i['id'] for i in d['items'].values() if i['origen'] == 'visto')
        self.assertEqual(d['items'][iid]['estado'], 'abierto')
        d['items'][iid].update(estado='corregido', nota='se arregló')
        mem.registrar('OLVER', 'Falló la exportación de la mesa 5 de RM7999')   # mismo error, otros números
        self.assertEqual(d['items'][iid]['estado'], 'regresion')
        self.assertTrue(mem.alertas())
        mem.registrar('OLVER', 'Falló la exportación de la mesa 6 de RM7000')
        self.assertEqual(d['items'][iid]['veces_despues'], 2)

    def test_solo_cuentan_los_errores(self):
        mem.registrar('TAVO', 'Todo bien', 'INFO')
        mem.registrar('TAVO', '', 'ERROR')
        self.assertFalse([i for i in mem._cargar()['items'].values() if i['origen'] == 'visto'])

    def test_lecciones_iniciales_y_regex(self):
        items = mem._cargar()['items']
        self.assertIn('leccion-zeus-referencia-exacta', items)
        self.assertEqual(items['leccion-effi-login']['estado'], 'corregido')
        mem.registrar('ZEUS', 'Error en Effi: reCAPTCHA no superado')   # coincide con la lección por su patrón
        self.assertEqual(mem._cargar()['items']['leccion-effi-login']['estado'], 'regresion')


if __name__ == '__main__':
    unittest.main()
