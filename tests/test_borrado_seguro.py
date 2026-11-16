"""El borrado de una orden sigue rechazando enlaces dentro de la carpeta (y ahora la revisión es una sola pasada, rápida)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

T = Path(tempfile.mkdtemp())
for k, v in dict(NAS_CLIENTES_PATH=str(T / 'C'), SUPABASE_URL='http://x', SUPABASE_KEY='x', GOOGLE_SHEETS_URL='http://x', GOOGLE_CREDENTIALS='{}',
                 PAGOS_COTIZACIONES_FILE_ID='x', PAGOS_COTIZACIONES_HOJA='x', SMTP_EMAIL='x', SMTP_PASSWORD='x', APP_USER='u', APP_PASSWORD='p').items():
    os.environ.setdefault(k, v)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from app import main  # noqa: E402


class RevisionCarpeta(unittest.TestCase):
    def setUp(self):
        self.c = Path(tempfile.mkdtemp()) / 'CO1_X'
        (self.c / 'APLIQUE').mkdir(parents=True)
        (self.c / 'a.pdf').write_bytes(b'x')
        (self.c / 'APLIQUE' / 'b.txt').write_text('x')

    def test_carpeta_normal_pasa(self):
        main._revisar_carpeta_sin_enlaces(self.c)

    def test_enlace_a_archivo_se_rechaza(self):
        (self.c / 'enlace.pdf').symlink_to(self.c / 'a.pdf')
        with self.assertRaises(HTTPException) as e:
            main._revisar_carpeta_sin_enlaces(self.c)
        self.assertEqual(e.exception.status_code, 409)

    def test_enlace_a_carpeta_anidada_se_rechaza(self):
        otra = Path(tempfile.mkdtemp())
        (self.c / 'APLIQUE' / 'salida').symlink_to(otra, target_is_directory=True)
        with self.assertRaises(HTTPException):
            main._revisar_carpeta_sin_enlaces(self.c)


if __name__ == '__main__':
    unittest.main()
