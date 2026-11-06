@echo off
setlocal
set "BASE=%LOCALAPPDATA%\IndoorSport\AgenteDIAN"
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python. Instale Python 3.11 o superior desde python.org y vuelva a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m playwright install chromium
echo.
echo Instalacion terminada. Ahora ejecute INICIAR_AGENTE_DIAN.bat
pause
