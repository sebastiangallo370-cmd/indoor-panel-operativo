"""Regla de pago por lotes del Excel de confección: la fecha de pago va solo en la primera fila del lote."""
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook

from app import contabilidad_confeccion as cc


def _libro(filas):
    book = Workbook()
    hoja = book.active
    hoja.title = 'Prueba.Unif'
    for fila in filas:   # columnas B..L: cliente, cotización, ref, desc, envío, entrega, env, rec, v/u, valor, pago
        hoja.append([None] + list(fila))
    ruta = Path(tempfile.mkdtemp()) / 'conf.xlsx'
    book.save(ruta)
    return ruta


def _fila(cot, envio, entrega, unidades, valor, pago=None):
    return ('CLIENTE', cot, 'REF', 'UNIFORME', datetime(*envio), datetime(*entrega) if entrega else None,
            unidades, unidades if entrega else None, valor // max(unidades, 1), valor if entrega else 0, pago)


class FechaPagoTest(unittest.TestCase):
    def test_textos(self):
        self.assertEqual(cc._fecha_pago('lunes 23 de noviembre 2026'), date(2026, 11, 23))
        self.assertEqual(cc._fecha_pago('martes 21 de julio 2026'), date(2026, 7, 21))   # no es marzo
        self.assertEqual(cc._fecha_pago('martes23 de junio 2026'), date(2026, 6, 23))
        self.assertEqual(cc._fecha_pago('martes 18 de agisto 2026'), date(2026, 8, 18))
        self.assertEqual(cc._fecha_pago('martes 20 de enro 2025'), date(2025, 1, 20))
        self.assertEqual(cc._fecha_pago('lunes 30 de marzo 2028'), date(2026, 3, 30))   # año mal digitado
        self.assertIsNone(cc._fecha_pago('CANCELADO'))


class LotesTest(unittest.TestCase):
    def test_lotes(self):
        ruta = _libro([
            _fila('A1', (2026, 11, 2), (2026, 11, 5), 10, 1000, 'lunes 9 de noviembre 2026'),
            _fila('A2', (2026, 11, 3), (2026, 11, 6), 10, 1000),                 # mismo lote: pagada
            _fila('B1', (2026, 11, 10), (2026, 11, 12), 10, 1000, 'lunes 23 de noviembre 2026'),
            _fila('B2', (2026, 11, 18), (2026, 11, 26), 10, 1000),               # entregada después del pago
            _fila('B3', (2026, 11, 20), (2026, 11, 23), 10, 1000),               # último lote, a tiempo: pagada
            _fila('C1', (2026, 11, 24), (2026, 11, 25), 10, 1000),               # ciclo en curso
            _fila('C2', (2026, 11, 25), None, 10, 0),                            # en proceso
        ])
        datos = cc._read(ruta)
        estado = {d['quote']: d['paid'] for d in datos['makers'][0]['details']}
        self.assertEqual(estado, {'A1': True, 'A2': True, 'B1': True, 'B2': False, 'B3': True, 'C1': False, 'C2': False})
        pagos = {d['quote']: d['payment'] for d in datos['makers'][0]['details']}
        self.assertEqual(pagos['A2'], '2026-11-09')
        self.assertEqual(datos['makers'][0]['pending_payment'], 2000)


if __name__ == '__main__':
    unittest.main()
