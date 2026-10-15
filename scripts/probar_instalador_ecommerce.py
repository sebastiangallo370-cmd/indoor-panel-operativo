"""Ejecuta SOLO los bloques de ECOMMERCE del instalador (3b y 4b) contra una carpeta temporal, con la NAS real y el perfil real
(el entorno de Python ya existe, así que pip solo confirma). No toca la instalación real de los agentes."""
import subprocess, sys, tempfile, shutil
from pathlib import Path

AG = Path(r'C:\Users\Administrador\Desktop\agentes_uniformes')
texto = (AG / 'INSTALAR_AGENTES_EDICION.vbs').read_bytes().decode('utf-8')
i3 = texto.index("' ---- 3b. ECOMMERCE")
f3 = texto.index("' ---- 4. Python y entorno")
i4 = texto.index("' ---- 4b. ECOMMERCE")
f4 = texto.index("' ---- 5. Carpeta CLIENTES")
base = Path(sys.argv[1])
instal = base / 'instalacion_prueba'
(instal / 'logs').mkdir(parents=True, exist_ok=True)
cabecera = f'''Option Explicit
Dim sh, fso, perfil, instal, NAS, venvPy
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
perfil = sh.ExpandEnvironmentStrings("%USERPROFILE%")
instal = "{instal}"
NAS = "\\\\192.168.0.120\\nas indoor\\DIRECCION PRODUCCION\\CARPETAS PERSONALES\\GALLO\\AGENTES_INDOOR"
venvPy = "{AG}\\.venv\\Scripts\\python.exe"
Function Ejecutar(cmd)
  Dim log
  log = instal & "\\logs\\instalacion.txt"
  Ejecutar = sh.Run("cmd /c """ & cmd & " >> """ & log & """ 2>&1""", 0, True)
End Function
'''
vbs = cabecera + texto[i3:f3].replace('\r\n', '\n') + texto[i4:f4].replace('\r\n', '\n') + '\nWScript.Echo "bloques 3b y 4b ejecutados"\n'
arch = base / 'prueba_instalador.vbs'
arch.write_text(vbs.replace('\n', '\r\n'), encoding='cp1252', errors='replace')
r = subprocess.run(['cscript', '//nologo', str(arch)], capture_output=True, text=True, encoding='cp1252', errors='replace', timeout=600)
print('cscript:', r.returncode, (r.stdout or '').strip(), (r.stderr or '').strip())
print('ecommerce copiado:', sorted(p.name for p in (instal / 'ecommerce').glob('*')))
log = (instal / 'logs' / 'instalacion.txt')
print('log (últimas líneas):')
for l in (log.read_text(encoding='cp850', errors='replace').splitlines()[-6:] if log.exists() else ['(sin log)']):
    print('  ', l[:150])
shutil.rmtree(base, ignore_errors=True)
print('limpio:', not base.exists())
