@echo off
cd /d "%~dp0"
if exist actualizar_desde_nas.bat call actualizar_desde_nas.bat
if not exist ".venv\Scripts\activate.bat" (
  echo Primero ejecuta instalar.bat
  pause
  exit /b 1
)
call .venv\Scripts\activate
rem ECOMMERCE (bots de Effi) arranca junto con los agentes: la primera vez pide el enlace con el panel.
if exist ecommerce\puente_ecommerce.py if not exist ecommerce\datos\panel.json python ecommerce\puente_ecommerce.py --conectar
if exist ecommerce\puente_ecommerce.py if exist ecommerce\datos\panel.json start "" /min python ecommerce\puente_ecommerce.py
start "" http://127.0.0.1:8000
python server.py
pause
