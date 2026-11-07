import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import dian


class _Done:
    def __init__(self, value):
        self.value = value

    def __await__(self):
        yield from ()
        return self.value


class _Request:
    def __init__(self, body=None, headers=None):
        self.body = body or {}
        self.headers = headers or {}

    def json(self):
        return _Done(self.body)


def _run(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    raise AssertionError('La corrutina de prueba no debía bloquearse.')


class DianTest(unittest.TestCase):
    def setUp(self):
        scratch = Path.cwd() / 'tmp'
        scratch.mkdir(exist_ok=True)
        self.tmp = Path(tempfile.mkdtemp(prefix='indoor-dian-', dir=scratch))
        self.previous = dian._db_file, dian._root, dian._token_file
        dian._db_file = self.tmp / 'state' / 'dian.sqlite3'
        dian._root = self.tmp / 'nas' / 'DIAN DESCARGAS'
        dian._token_file = self.tmp / 'state' / 'worker-token'
        dian._active_tokens.clear()
        dian.configurar(lambda request: 'Prueba')
        self.cufe = 'a' * 96

    def tearDown(self):
        dian._active_tokens.clear()
        dian._db_file, dian._root, dian._token_file = self.previous
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _batch(self):
        response = _run(dian.create_batch(_Request({
            'token': 'https://catalogo-vpfe.dian.gov.co/User/AuthToken?temporal=ok',
            'cufes': self.cufe + '\n' + self.cufe,
            'carpeta': '2026/noviembre',
            'format': 'XML',
            'fecha_desde': '2026-01-01',
            'fecha_hasta': '2026-12-31',
        })))
        return response

    def test_lote_guarda_un_cufe_y_no_expone_token(self):
        data = self._batch()
        self.assertEqual((data['total'], data['duplicates'], data['destination']), (1, 1, '2026/noviembre'))
        self.assertNotIn('temporal=ok', str(data))

    def test_worker_reserva_y_cierra_un_cufe(self):
        batch = self._batch()
        token = dian._token_file.read_text(encoding='utf-8').strip()
        headers = {'x-dian-worker-token': token}
        claim = dian.worker_claim(_Request(headers=headers))
        job = claim['job']
        self.assertEqual(job['cufe'], self.cufe.upper())
        result = _run(dian.worker_result(_Request({
            'document_id': job['document_id'], 'status': 'downloaded',
            'filename': 'NOVIEMBRE_06/factura.xml', 'evidence': 'Archivo DIAN descargado.',
        }, headers=headers)))
        self.assertTrue(result['ok'])
        status = dian.get_batch(batch['batch_id'], _Request())
        self.assertEqual((status['status'], status['downloaded']), ('completed', 1))

    def test_rechaza_lote_incompleto_o_carpeta_insegura(self):
        payload = {'token': '', 'cufes': self.cufe, 'fecha_desde': '2026-01-01', 'fecha_hasta': '2026-12-31'}
        with self.assertRaises(Exception) as missing:
            _run(dian.create_batch(_Request(payload)))
        self.assertEqual(getattr(missing.exception, 'status_code', None), 400)
        payload.update(token='https://catalogo-vpfe.dian.gov.co/User/AuthToken?ok', carpeta='../afuera')
        with self.assertRaises(Exception) as unsafe:
            _run(dian.create_batch(_Request(payload)))
        self.assertEqual(getattr(unsafe.exception, 'status_code', None), 400)


if __name__ == '__main__':
    unittest.main()
