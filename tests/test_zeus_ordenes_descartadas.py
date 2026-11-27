"""Una orden que el usuario dio por entregada no vuelve a generar compra de tela (caso RM7697 / ZANETTI).

Antes, al ocultar el registro, el cálculo lo recreaba en cada sincronización porque la tela seguía figurando como faltante.
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import zeus


def _falta(orden, tela, mts):
    return {'tela': tela, 'orden': orden, 'cliente': 'C', 'proyecto': 'P', 'referencia': 'R', 'entrega': '2026-11-20',
            'mts': mts, 'falta': mts, 'situacion': 'no_alcanza', 'telas': ['(6632) ZANETTI BEISH']}


class OrdenesDescartadasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.archivo = Path(self.tmp.name) / 'zeus.json'
        self.patches = [mock.patch.object(zeus, '_file', self.archivo)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def _sincronizar(self, filas):
        with mock.patch.object(zeus, '_faltantes', lambda: filas):
            return zeus.sincronizar()

    def test_orden_descartada_no_genera_item(self):
        d = zeus._leer()
        d['ordenes_descartadas'] = ['RM7697']
        zeus._guardar(d)
        r = self._sincronizar([_falta('RM7697', 'ZANETTI', 19.6)])
        self.assertEqual(r['nuevas'], 0)
        self.assertEqual([i for i in zeus._leer()['items'] if i['tela'] == 'ZANETTI'], [])

    def test_otra_orden_sigue_generando(self):
        d = zeus._leer()
        d['ordenes_descartadas'] = ['RM7697']
        zeus._guardar(d)
        r = self._sincronizar([_falta('RM7697', 'ZANETTI', 19.6), _falta('CO6469', 'SPIRIT PLUS', 73.36)])
        self.assertEqual(r['nuevas'], 1)
        items = [i for i in zeus._leer()['items'] if i['tela'] == 'SPIRIT PLUS (MONTECATINI)' or i['tela'] == 'SPIRIT PLUS']
        self.assertEqual(len(items), 1)

    def test_sin_descartadas_se_comporta_igual(self):
        r = self._sincronizar([_falta('RM7697', 'ZANETTI', 19.6)])
        self.assertEqual(r['nuevas'], 1)


if __name__ == '__main__':
    unittest.main()
