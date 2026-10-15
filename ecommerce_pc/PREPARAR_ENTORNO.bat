@echo off
rem ECOMMERCE: prepara el entorno de Python de los agentes de ordenes de venta (una sola vez por PC).
rem Crea %LOCALAPPDATA%\IndoorBot_OrdenesVenta\venv e instala lo que pide BOT_ORDENES_VENTA\requirements.txt.
rem NO arranca ningun bot ni toca Effi.
title ECOMMERCE - preparar entorno
set "VENV=%LOCALAPPDATA%\IndoorBot_OrdenesVenta\venv"
set "REQ=\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\Automatizacion\AUTOMATIZACION_PAGINA WEB\BOT_ORDENES_VENTA\requirements.txt"
where python >nul 2>&1
if errorlevel 1 (
  echo No encuentro Python. Instalalo desde python.org ^(marca "Add Python to PATH"^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist "%REQ%" (
  echo No encuentro %REQ%
  echo Revisa que este conectada la NAS.
  pause
  exit /b 1
)
if not exist "%VENV%\Scripts\python.exe" (
  echo Creando el entorno en %VENV% ...
  python -m venv "%VENV%"
  if errorlevel 1 (
    echo No se pudo crear el entorno.
    pause
    exit /b 1
  )
)
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV%\Scripts\python.exe" -m pip install -r "%REQ%"
if errorlevel 1 (
  echo Fallo la instalacion de paquetes.
  pause
  exit /b 1
)
echo.
echo Listo: los agentes de ECOMMERCE ya tienen sus paquetes. Ahora abre iniciar_oculto.vbs.
pause
