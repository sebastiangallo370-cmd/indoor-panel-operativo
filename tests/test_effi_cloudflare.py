"""Effi detrás de Cloudflare: el agente identifica como navegador (no como Python) y un bloqueo 1010 se informa como bloqueo, no como permiso de la llave."""
import io
import unittest
import urllib.error
from unittest import mock

from app import effi_api

CLOUDFLARE = b'{"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/","title":"Error 1010: Access denied","status":403}'


def _error_403(cuerpo: bytes):
    return urllib.error.HTTPError('https://effi.com.co/api/articulo', 403, 'Forbidden', {}, io.BytesIO(cuerpo))


class CloudflareEffi(unittest.TestCase):
    def setUp(self):
        effi_api.usar_llave('K' * 40)

    def tearDown(self):
        effi_api.usar_llave('')

    def test_envia_user_agent_de_navegador(self):
        capturada = {}

        def falsa(req, timeout=None):
            capturada['ua'] = req.get_header('User-agent')
            raise _error_403(CLOUDFLARE)
        with mock.patch.object(effi_api.urllib.request, 'urlopen', side_effect=falsa):
            with self.assertRaises(effi_api.EffiError):
                effi_api._peticion('GET', 'articulo', {'referencia': 'A1'})
        self.assertIn('Mozilla', capturada['ua'])
        self.assertNotIn('Python', capturada['ua'])

    def test_bloqueo_de_cloudflare_no_se_confunde_con_permisos(self):
        with mock.patch.object(effi_api.urllib.request, 'urlopen', side_effect=lambda *a, **k: (_ for _ in ()).throw(_error_403(CLOUDFLARE))):
            with self.assertRaises(effi_api.EffiError) as e:
                effi_api._peticion('POST', 'orden_c', cuerpo={'x': 1})
        self.assertIn('Cloudflare', str(e.exception))
        self.assertNotIn('no tiene permiso', str(e.exception))

    def test_un_403_de_effi_con_mensaje_sigue_igual(self):
        cuerpo = '{"mensaje":"La API key no tiene permiso para Articulos - Costos"}'.encode('utf-8')
        with mock.patch.object(effi_api.urllib.request, 'urlopen', side_effect=lambda *a, **k: (_ for _ in ()).throw(_error_403(cuerpo))):
            with self.assertRaises(effi_api.EffiError) as e:
                effi_api._peticion('GET', 'articulo')
        self.assertEqual(str(e.exception), 'La API key no tiene permiso para Articulos - Costos')


if __name__ == '__main__':
    unittest.main()
