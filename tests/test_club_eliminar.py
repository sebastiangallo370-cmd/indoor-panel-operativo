"""Eliminar una reprogramación de club: desaparece de la lista pero la fila queda en la base (estado 'eliminada')."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app import club


class Eliminar(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        ruta = Path(self.dir.name) / 'j.sqlite3'

        def conectar():
            c = sqlite3.connect(str(ruta))
            c.row_factory = sqlite3.Row
            return c
        club.configurar(conectar, lambda r: 'Indoor Sport', lambda u: True, lambda *a: False, lambda i: {})
        with conectar() as db:
            for estado in ('aprobada', 'rechazada', 'pendiente'):
                db.execute("INSERT INTO club_pedidos(link_id, cliente, lineas, estado) VALUES (1, 'CLUB', '[]', ?)", (estado,))
        self.conectar = conectar

    def tearDown(self):
        self.dir.cleanup()

    def test_eliminada_no_sale_en_la_lista_ni_se_borra_de_la_base(self):
        req = mock.Mock()
        self.assertEqual(len(club.listar_pedidos(req)['pedidos']), 3)
        self.assertEqual(club.eliminar_pedido(req, 1), {'ok': True})
        self.assertEqual(sorted(p['id'] for p in club.listar_pedidos(req)['pedidos']), [2, 3])
        self.assertEqual(club.listar_pedidos(req, 'aprobada')['pedidos'], [])
        with self.conectar() as db:
            fila = db.execute('SELECT estado, resuelto_por FROM club_pedidos WHERE id=1').fetchone()
        self.assertEqual((fila['estado'], fila['resuelto_por']), ('eliminada', 'Indoor Sport'))

    def test_eliminar_uno_que_no_existe(self):
        with self.assertRaises(HTTPException) as e:
            club.eliminar_pedido(mock.Mock(), 99)
        self.assertEqual(e.exception.status_code, 404)

    def test_solo_comercial_puede_eliminar(self):
        club._permitido = lambda u: False
        with self.assertRaises(HTTPException) as e:
            club.eliminar_pedido(mock.Mock(), 1)
        self.assertEqual(e.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
