@echo off
chcp 65001 >nul
title Worker Local - Indoor Sport

echo ============================================================
echo    WORKER LOCAL - Indoor Sport
echo ============================================================
echo.
echo  Este programa vigila el panel web y sincroniza
echo  las ordenes completadas con el NAS de la oficina.
echo.
echo  Para detenerlo, cierra esta ventana o presiona Ctrl+C.
echo ============================================================
echo.

:: Ir a la carpeta del proyecto
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
if exist "%SCRIPT_DIR%\..\worker_local.py" (
    cd /d "%SCRIPT_DIR%\.."
) else (
    cd /d "%SCRIPT_DIR%"
)

:: Verificar que existe el .env
if not exist ".env" (
    echo [ERROR] No se encontro el archivo .env
    echo Crea el archivo .env con estas variables:
    echo.
    echo   SERVIDOR_URL=https://tu-dominio.ngrok-free.app
    echo   APP_USER=indoor
    echo   APP_PASSWORD=tu_clave
    echo   NAS_CLIENTES_PATH=\\192.168.0.120\nas indoor\CLIENTES
    echo.
    pause
    exit /b 1
)

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no encontrado. Instala Python y agrega al PATH.
    pause
    exit /b 1
)

:: Arrancar el worker
echo Arrancando worker...
echo.
python worker_local.py

echo.
echo Worker detenido.
pause
