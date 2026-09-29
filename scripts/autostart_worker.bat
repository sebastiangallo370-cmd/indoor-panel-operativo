@echo off
chcp 65001 >nul
echo ============================================================
echo  Configurar Worker para inicio automatico con Windows
echo ============================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Detectar carpeta del proyecto
if exist "%SCRIPT_DIR%\..\worker_local.py" (
    for %%I in ("%SCRIPT_DIR%\..") do set "PROJECT_DIR=%%~fI"
) else (
    set "PROJECT_DIR=%SCRIPT_DIR%"
)

set "WORKER_BAT=%SCRIPT_DIR%\worker_windows.bat"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\Indoor Worker.lnk"

:: Crear acceso directo en la carpeta de inicio de Windows
echo Creando acceso directo en: %STARTUP_DIR%
echo.

:: Usar PowerShell para crear el acceso directo
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%WORKER_BAT%'; $s.WorkingDirectory = '%PROJECT_DIR%'; $s.Description = 'Worker Local Indoor Sport'; $s.WindowStyle = 7; $s.Save()"

if exist "%SHORTCUT%" (
    echo [OK] Worker configurado para iniciar automaticamente.
    echo.
    echo El worker arrancara cada vez que enciendas el PC.
    echo Para desactivarlo, borra el acceso directo de:
    echo   %STARTUP_DIR%
) else (
    echo [ERROR] No se pudo crear el acceso directo.
    echo Crea manualmente un acceso directo de:
    echo   %WORKER_BAT%
    echo en la carpeta:
    echo   %STARTUP_DIR%
)

echo.
pause
