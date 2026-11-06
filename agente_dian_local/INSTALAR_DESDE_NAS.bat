@echo off
setlocal
set "ORIGEN=%~dp0"
set "DESTINO=%LOCALAPPDATA%\IndoorSport\AgenteDIAN"
echo Copiando agente DIAN a este PC...
robocopy "%ORIGEN%" "%DESTINO%" /E /XD .venv __pycache__ /XF *.log >nul
if errorlevel 8 (
  echo No se pudo copiar el agente desde la NAS.
  pause
  exit /b 1
)
call "%DESTINO%\instalar_local.bat"
