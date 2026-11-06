@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Primero ejecute INSTALAR_DESDE_NAS.bat o instalar_local.bat
  pause
  exit /b 1
)
start "Agente DIAN Indoor" http://127.0.0.1:17877
".venv\Scripts\python.exe" agente_dian.py
