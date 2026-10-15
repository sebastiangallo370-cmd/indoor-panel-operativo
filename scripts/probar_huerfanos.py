"""Prueba de limpiar_huerfanos(): un proceso con «agente_ov.py» en su comando (huérfano) debe cerrarse; uno ajeno, no."""
import importlib.util, subprocess, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pe', RAIZ / 'ecommerce_pc' / 'puente_ecommerce.py')
pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pe)
SIN_VENTANA = 0x08000000
falso = subprocess.Popen([sys.executable, '-c', 'import time\n# agente_ov.py falso\ntime.sleep(60)'], creationflags=SIN_VENTANA)
ajeno = subprocess.Popen([sys.executable, '-c', 'import time\ntime.sleep(60)'], creationflags=SIN_VENTANA)
time.sleep(1.5)
pe.limpiar_huerfanos()
time.sleep(1.5)
print('huérfano cerrado:', falso.poll() is not None, '| proceso ajeno sigue vivo:', ajeno.poll() is None)
ajeno.kill()
falso.kill()
