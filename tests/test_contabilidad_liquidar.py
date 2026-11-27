"""Liquidar confección: marca lo pendiente de una confeccionista como pagado y el contador vuelve a cero.

Usa archivos temporales (nunca /data). La liquidación se guarda aparte de la copia 2026, así que sobrevive a regenerarla.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from fastapi import HTTPException  # noqa: E402

from app import contabilidad_confeccion as cc  # noqa: E402


def _fila(maker, cliente, cotizacion, amount, paid=False, received=10):
    return {
        'maker': maker, 'client': cliente, 'client_type': 'Empresas', 'quote': cotizacion, 'reference': 'A100',
        'product': 'UNIFORME', 'product_category': 'Conjuntos', 'sent_date': '2026-11-01', 'received_date': '2026-11-05',
        'sent': received, 'received': received, 'amount': amount, 'paid': paid, 'payment': None, 'unit_value': amount / received,
    }


def _base(filas):
    makers = {}
    for f in filas:
        makers.setdefault(f['maker'], []).append(f)
    lista = []
    for nombre, rows in makers.items():
        lista.append({
            'name': nombre, 'orders': len(rows), 'sent': sum(r['sent'] for r in rows), 'received': sum(r['received'] for r in rows),
            'pending_units': 0, 'amount': sum(r['amount'] for r in rows), 'paid': sum(r['amount'] for r in rows if r['paid']),
            'pending_payment': sum(r['amount'] for r in rows if not r['paid']), 'average_days': None, 'completion_rate': 100,
            'average_value_per_unit': None,
            'details': [{k: v for k, v in r.items() if k != 'maker'} for r in rows],
        })
    total = sum(f['amount'] for f in filas)
    pagado = sum(f['amount'] for f in filas if f['paid'])
    return {
        'year': 2026, 'makers': lista, 'details': filas, 'monthly': [], 'products': [], 'pending': [],
        'summary': {'orders': len(filas), 'amount': total, 'paid': pagado, 'pending_payment': total - pagado,
                    'payment_marked_rate': round(pagado / total * 100, 1)},
    }


class LiquidarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.copia = Path(self.tmp.name) / 'contabilidad_2026.json'
        self.liq = Path(self.tmp.name) / 'liquidaciones.json'
        self.filas = [
            _fila('Gloria Vallejo', 'CLUB A', 'RM1', 1000),
            _fila('Gloria Vallejo', 'CLUB B', 'RM2', 2000, paid=True),
            _fila('Gloria Vallejo', 'CLUB C', 'RM3', 3000),
            _fila('Otra Costurera', 'CLUB D', 'RM4', 500),
        ]
        self.copia.write_text(json.dumps(_base(self.filas)), encoding='utf-8')
        os.environ['CONFECCION_DATA_PATH'] = str(self.copia)
        os.environ['CONFECCION_LIQUIDACIONES_PATH'] = str(self.liq)
        cc._cache.update({'mtime': None, 'data': None})

    def tearDown(self):
        os.environ.pop('CONFECCION_DATA_PATH', None)
        os.environ.pop('CONFECCION_LIQUIDACIONES_PATH', None)
        self.tmp.cleanup()

    def _maker(self, data, nombre):
        return next(m for m in data['makers'] if m['name'] == nombre)

    def test_liquida_solo_lo_pendiente_y_reinicia_el_contador(self):
        resp = cc.liquidar(cc.LiquidarIn(maker='Gloria Vallejo', fecha='2026-11-26'))
        self.assertEqual(resp['liquidacion']['registros'], 2)
        self.assertEqual(resp['liquidacion']['valor'], 4000)
        data = cc.get_data()
        gloria = self._maker(data, 'Gloria Vallejo')
        self.assertEqual(gloria['pending_payment'], 0)
        self.assertEqual(gloria['paid'], gloria['amount'])
        otra = self._maker(data, 'Otra Costurera')
        self.assertEqual(otra['pending_payment'], 500)   # la otra confeccionista no cambia
        self.assertEqual(data['summary']['pending_payment'], 500)

    def test_no_liquida_dos_veces_lo_mismo(self):
        cc.liquidar(cc.LiquidarIn(maker='Gloria Vallejo'))
        with self.assertRaises(HTTPException) as ctx:
            cc.liquidar(cc.LiquidarIn(maker='Gloria Vallejo'))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_sobrevive_a_regenerar_la_copia(self):
        cc.liquidar(cc.LiquidarIn(maker='Gloria Vallejo', fecha='2026-11-26'))
        # El Excel se regenera: la copia vuelve a decir «pendiente»
        self.copia.write_text(json.dumps(_base(self.filas)), encoding='utf-8')
        os.utime(self.copia, (os.path.getatime(self.copia), os.path.getmtime(self.copia) + 5))
        data = cc.get_data()
        self.assertEqual(self._maker(data, 'Gloria Vallejo')['pending_payment'], 0)
        marcados = [d for d in data['details'] if d['maker'] == 'Gloria Vallejo' and d['paid']]
        self.assertTrue(all(d['payment'] == 'Liquidado 2026-11-26' for d in marcados if d['payment'] and d['payment'].startswith('Liquidado')))

    def test_fecha_invalida_y_maker_vacio(self):
        with self.assertRaises(HTTPException):
            cc.liquidar(cc.LiquidarIn(maker='Gloria Vallejo', fecha='26/11/2026'))
        with self.assertRaises(HTTPException):
            cc.liquidar(cc.LiquidarIn(maker='  '))

    def test_maker_sin_pendientes(self):
        with self.assertRaises(HTTPException) as ctx:
            cc.liquidar(cc.LiquidarIn(maker='Nadie'))
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
