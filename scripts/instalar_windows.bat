@echo off
chcp 65001 >nul
title Instalador Panel Operativo Indoor Sport

echo ============================================================
echo    INSTALADOR - Panel Operativo Indoor Sport
echo ============================================================
echo.

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no esta instalado o no esta en el PATH.
    echo Descargalo de https://www.python.org/downloads/
    echo IMPORTANTE: Marca "Add Python to PATH" al instalar.
    pause
    exit /b 1
)
echo [OK] Python encontrado
python --version

:: Verificar Git
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git no esta instalado.
    echo Descargalo de https://git-scm.com/download/win
    pause
    exit /b 1
)
echo [OK] Git encontrado

:: Definir ruta de instalacion
set "INSTALL_DIR=%~dp0indoor-panel-operativo"
echo.
echo El proyecto se instalara en:
echo %INSTALL_DIR%
echo.

:: Clonar o actualizar
if exist "%INSTALL_DIR%\.git" (
    echo [INFO] El proyecto ya existe. Actualizando...
    cd /d "%INSTALL_DIR%"
    git pull origin main
) else (
    echo [INFO] Clonando proyecto desde GitHub...
    cd /d "%~dp0"
    git clone https://github.com/sebastiangallo370-cmd/indoor-panel-operativo.git
    if errorlevel 1 (
        echo [ERROR] No se pudo clonar el repositorio.
        pause
        exit /b 1
    )
    cd /d "%INSTALL_DIR%"
)
echo [OK] Proyecto listo

:: Instalar dependencias Python
echo.
echo [INFO] Instalando dependencias de Python...
pip install -r requirements.txt
if errorlevel 1 (
    echo [AVISO] Hubo errores instalando dependencias. Reintentando con --user...
    pip install --user -r requirements.txt
)
pip install python-dotenv
echo [OK] Dependencias instaladas

:: Crear carpetas necesarias
echo.
echo [INFO] Creando carpetas...
if not exist "data\uploads\pedidos" mkdir "data\uploads\pedidos"
if not exist "data\state" mkdir "data\state"
if not exist "secrets" mkdir "secrets"
echo [OK] Carpetas creadas

:: Crear .env si no existe
if not exist ".env" (
    echo.
    echo [INFO] Creando archivo .env de desarrollo...
    (
        echo # Desarrollo: desactivar Google Sheets y Supabase sync
        echo DISABLE_EXTERNAL_SYNC=1
        echo.
        echo # Acceso al asistente web
        echo APP_USER=indoor
        echo APP_PASSWORD=indoor2024
        echo.
        echo # No aplica en desarrollo local
        echo NGROK_AUTHTOKEN=disabled
        echo NGROK_DOMAIN=disabled.ngrok-free.app
        echo CLOUDFLARE_API_TOKEN=disabled
        echo.
        echo # Destinos
        echo NAS_CLIENTES_PATH=\\192.168.0.120\nas indoor\CLIENTES
        echo GOOGLE_SHEETS_URL=https://docs.google.com/spreadsheets/d/placeholder/edit
        echo GOOGLE_SHEETS_GID=0
        echo PEDIDOS_GOOGLE_SHEETS_GID=1514880696
        echo GOOGLE_CREDENTIALS=secrets/google-service-account.json
        echo.
        echo # Supabase
        echo SUPABASE_URL=https://placeholder.supabase.co
        echo SUPABASE_KEY=placeholder
        echo.
        echo # Control de pagos
        echo PAGOS_COTIZACIONES_FILE_ID=placeholder
        echo PAGOS_COTIZACIONES_HOJA=CONTROL DE PAGOS
        echo.
        echo # Correo
        echo SMTP_EMAIL=placeholder@gmail.com
        echo SMTP_PASSWORD=placeholder
        echo SMTP_SERVER=smtp.gmail.com
        echo SMTP_PORT=587
    ) > .env
    echo [OK] Archivo .env creado con valores de desarrollo
) else (
    echo [OK] Archivo .env ya existe, no se toca
)

:: Verificar FORMATO_EXCEL.xlsx
echo.
if not exist "FORMATO_EXCEL.xlsx" (
    echo [AVISO] Falta FORMATO_EXCEL.xlsx en la raiz del proyecto.
    echo         Copialo manualmente al proyecto para procesar documentos.
) else (
    echo [OK] FORMATO_EXCEL.xlsx encontrado
)

:: Verificar credenciales Google
if not exist "secrets\google-service-account.json" (
    echo [AVISO] Falta secrets\google-service-account.json
    echo         Copialo manualmente para habilitar Google Sheets.
) else (
    echo [OK] Credenciales Google encontradas
)

:: Resumen final
echo.
echo ============================================================
echo    INSTALACION COMPLETADA
echo ============================================================
echo.
echo  Usuario:  indoor
echo  Clave:    indoor2024
echo  URL:      http://localhost:8000
echo.
echo  Para arrancar el servidor ejecuta:
echo    cd "%INSTALL_DIR%"
echo    python start_dev.py
echo.
echo  O haz doble clic en: arrancar.bat
echo ============================================================
echo.

:: Crear script de arranque rapido
(
    echo @echo off
    echo title Panel Operativo Indoor Sport
    echo cd /d "%INSTALL_DIR%"
    echo echo Arrancando servidor en http://localhost:8000 ...
    echo echo Presiona Ctrl+C para detener.
    echo echo.
    echo python start_dev.py
    echo pause
) > "%INSTALL_DIR%\arrancar.bat"
echo [OK] Creado arrancar.bat para iniciar rapido

echo.
echo Quieres arrancar el servidor ahora? (S/N)
set /p ARRANCAR=
if /i "%ARRANCAR%"=="S" (
    echo.
    echo Arrancando en http://localhost:8000 ...
    echo Presiona Ctrl+C para detener.
    python start_dev.py
)

pause
