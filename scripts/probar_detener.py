"""Prueba la línea de detener_agentes.bat que cierra ECOMMERCE: debe matar procesos con puente_ecommerce / agente_ov en su comando
(y sus hijos) y NO tocar a los agentes de edición ni a otros procesos."""
import re, subprocess, sys, time
from pathlib import Path

bat = (Path(r'C:\Users\Administrador\Desktop\agentes_uniformes') / 'detener_agentes.bat').read_text(encoding='utf-8', errors='replace')
linea = next(l for l in bat.splitlines() if 'puente_ecommerce|agente_ov' in l)
SV = 0x08000000
puente = subprocess.Popen([sys.executable, '-c', 'import time\n# puente_ecommerce.py falso\ntime.sleep(90)'], creationflags=SV)
agente = subprocess.Popen([sys.executable, '-c', 'import time\n# agente_ov.py falso\ntime.sleep(90)'], creationflags=SV)
ajeno = subprocess.Popen([sys.executable, '-c', 'import time\n# agentes de edicion\ntime.sleep(90)'], creationflags=SV)
time.sleep(1.5)
cmd = re.sub(r'^powershell -NoProfile -Command ', '', linea.strip())
subprocess.run(['powershell', '-NoProfile', '-Command', cmd.strip('"')], capture_output=True, timeout=60, creationflags=SV)
time.sleep(1.5)
print('puente falso cerrado:', puente.poll() is not None, '| agente falso cerrado:', agente.poll() is not None, '| ajeno sigue vivo:', ajeno.poll() is None)
ajeno.kill(); puente.kill(); agente.kill()
