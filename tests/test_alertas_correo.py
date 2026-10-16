import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app'))

import alertas_correo as a  # noqa: E402


class VigiaTest(unittest.TestCase):
    def test_exige_dos_revisiones_y_avisa_una_vez(self):
        v = a.Vigia()
        self.assertEqual(v.revisar(['NAS caído']), ([], []))
        self.assertEqual(v.revisar(['NAS caído']), (['NAS caído'], []))
        self.assertEqual(v.revisar(['NAS caído']), ([], []))

    def test_avisa_resuelto(self):
        v = a.Vigia()
        v.revisar(['X']); v.revisar(['X'])
        self.assertEqual(v.revisar([]), ([], ['X']))
        self.assertEqual(v.revisar([]), ([], []))

    def test_parpadeo_no_avisa(self):
        v = a.Vigia()
        v.revisar(['X']); v.revisar([]); v.revisar(['X'])
        self.assertEqual(v.revisar([]), ([], []))

    def test_recuerda_tras_reinicio(self):
        f = Path(tempfile.mkdtemp()) / 'e.json'
        v = a.Vigia(f); v.revisar(['X']); v.revisar(['X'])
        self.assertEqual(a.Vigia(f).revisar(['X']), ([], []))


if __name__ == '__main__':
    unittest.main()
