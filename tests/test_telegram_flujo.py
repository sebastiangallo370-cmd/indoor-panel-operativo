import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import telegram_flujo as f  # noqa: E402


def clientes(q):
    return ['CLUB SAN LORENZO DE LA PAZ'] if 'san' in q.lower() else []


def referencias(cliente, q):
    return ['A100FUT01']


class FlujoTelegramTest(unittest.TestCase):
    def paso(self, estado, entrada):
        return f.procesar(estado, entrada, buscar_clientes=clientes, buscar_referencias=referencias)

    def test_cotizacion_completa_llega_al_resumen(self):
        e, t, k = self.paso(None, '/cotizar')
        self.assertEqual(e['tipo'], 'cotizacion')
        e, t, k = self.paso(e, 'san lorenzo')
        self.assertEqual(e['paso'], 'cliente_elegir')   # el cliente se confirma con un botón
        e, t, k = self.paso(e, 'c:CLUB SAN LORENZO DE LA PAZ')
        self.assertEqual(e['cliente'], 'CLUB SAN LORENZO DE LA PAZ')
        e, t, k = self.paso(e, 'a100fut01')
        e, t, k = self.paso(e, 't:M')
        e, t, k = self.paso(e, '30')
        self.assertEqual(e['lineas'], [{'referencia': 'A100FUT01', 'talla': 'M', 'cantidad': 30}])
        e, t, k = self.paso(e, 'mas:no')
        e, t, k = self.paso(e, 'p:Contado')
        self.assertEqual(e['paso'], 'entrega')   # nunca se asume la fecha: se pregunta
        e, t, k = self.paso(e, 'e:15')
        self.assertEqual(e['paso'], 'resumen')
        self.assertIn('Contado', t)
        self.assertIn('Fecha de entrega', t)
        self.assertEqual(k[0][0]['callback_data'], 'crear')

    def test_fecha_escrita_y_fechas_dictadas(self):
        e = {'paso': 'entrega'}
        self.assertEqual(f.parse_fecha('20/12/2026'), '2026-12-20')
        self.assertEqual(f.parse_fecha('20 de diciembre de 2026'), '2026-12-20')
        self.assertEqual(f.parse_fecha('2026-12-20'), '2026-12-20')
        self.assertIsNone(f.parse_fecha('mañana más o menos'))
        self.assertEqual(f.interpretar_voz(e, 'en quince días'), 'en quince días')
        self.assertEqual(f.interpretar_voz(e, 'en 15 días'), 'e:15')
        self.assertEqual(f.interpretar_voz(e, 'en 30 días'), 'e:30')

    def test_escribir_fecha_en_el_paso_de_entrega(self):
        e, _, _ = self.paso(None, '/cotizar')
        e, _, _ = self.paso(e, 'san lorenzo')
        e, _, _ = self.paso(e, 'c:CLUB SAN LORENZO DE LA PAZ')
        e, _, _ = self.paso(e, 'a100fut01')
        e, _, _ = self.paso(e, 't:M')
        e, _, _ = self.paso(e, '30')
        e, _, _ = self.paso(e, 'mas:no')
        e, _, _ = self.paso(e, 'p:Contado')
        e, t, _ = self.paso(e, 'e:otra')
        self.assertEqual(e['paso'], 'entrega_fecha')
        e, t, _ = self.paso(e, '20/12/2026')
        self.assertEqual(e['entrega'], '2026-12-20')
        self.assertEqual(e['paso'], 'resumen')

    def test_cliente_no_encontrado_no_avanza(self):
        e, _, _ = self.paso(None, '/remision')
        e, t, _ = self.paso(e, 'cliente que no existe')
        self.assertEqual(e['paso'], 'cliente')
        self.assertIn('No encontré', t)

    def test_cantidad_invalida_se_rechaza(self):
        e, _, _ = self.paso(None, '/cotizar')
        e, _, _ = self.paso(e, 'san lorenzo')
        e, _, _ = self.paso(e, 'c:CLUB SAN LORENZO DE LA PAZ')
        e, _, _ = self.paso(e, 'a100fut01')
        e, _, _ = self.paso(e, 't:S')
        for malo in ['0', 'abc', '99999']:
            e, t, _ = self.paso(e, malo)
            self.assertEqual(e['paso'], 'cantidad')

    def test_cancelar_limpia_y_no_crea(self):
        e, _, _ = self.paso(None, '/cotizar')
        e, t, _ = self.paso(e, '/cancelar')
        self.assertEqual(e['paso'], 'inicio')
        self.assertIn('No se creó nada', t)

    def test_tipo_remision(self):
        e, _, _ = self.paso(None, '/remision')
        self.assertEqual(e['tipo'], 'remision')

    def test_voz_llena_talla_cantidad_y_pago(self):
        e, _, _ = self.paso(None, '/cotizar')
        self.assertEqual(f.interpretar_voz(e, 'Cliente'), 'Cliente')
        e = {'paso': 'talla'}
        self.assertEqual(f.interpretar_voz(e, 'la talla es m'), 't:M')
        e = {'paso': 'cantidad'}
        self.assertEqual(f.interpretar_voz(e, '30 unidades'), '30')
        e = {'paso': 'pago'}
        self.assertEqual(f.interpretar_voz(e, 'contado'), 'p:Contado')
        self.assertEqual(f.interpretar_voz(e, 'a treinta días'), 'p:Crédito 30 días')
        self.assertEqual(f.interpretar_voz(e, 'a sesenta días'), 'p:Crédito 60 días')
        e = {'paso': 'mas'}
        self.assertEqual(f.interpretar_voz(e, 'no, ya'), 'mas:no')

    def test_voz_con_respuesta_no_entendida_se_pide_de_nuevo(self):
        e, _, _ = self.paso(None, '/cotizar')
        e, _, _ = self.paso(e, 'san lorenzo')
        e, _, _ = self.paso(e, 'c:CLUB SAN LORENZO DE LA PAZ')
        e, _, _ = self.paso(e, 'a100fut01')
        e, _, _ = self.paso(e, f.interpretar_voz(e, 'talla enorme'))
        self.assertEqual(e['paso'], 'talla')


if __name__ == '__main__':
    unittest.main()
