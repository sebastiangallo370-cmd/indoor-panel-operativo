@echo off
setlocal
title Instalador Agente de Confeccion
set "DEST=C:\IndoorAgentes\Confeccion"
set "ORIGEN=%~dp0"

if not exist "%ORIGEN%confeccion_agente.py" (
  echo Extrae primero todo el ZIP del agente y ejecuta este archivo desde esa carpeta.
  pause
  exit /b 1
)
if not exist "%ORIGEN%datos\panel.json" (
  echo Falta el enlace privado al panel. Descarga de nuevo el paquete desde el panel.
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%ORIGEN%confeccion_agente.py" "%DEST%\confeccion_agente.py" >nul
copy /Y "%ORIGEN%whatsapp_playwright.py" "%DEST%\whatsapp_playwright.py" >nul
copy /Y "%ORIGEN%iniciar_oculto.vbs" "%DEST%\iniciar_oculto.vbs" >nul
if not exist "%DEST%\iniciar_oculto.vbs" (
  echo No se pudo copiar el iniciador del agente. Ejecuta este archivo como administrador otra vez.
  pause
  exit /b 1
)
if not exist "%DEST%\datos" mkdir "%DEST%\datos"
copy /Y "%ORIGEN%datos\panel.json" "%DEST%\datos\panel.json" >nul
if not exist "%DEST%\logs" mkdir "%DEST%\logs"

py -3.11 --version >nul 2>nul
if errorlevel 1 (
  echo Python 3.11 no esta instalado. Instalando Python 3.11...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Este equipo no tiene Winget para instalar Python automaticamente.
    echo Instala Python 3.11 o superior y vuelve a ejecutar este instalador.
    pause
    exit /b 1
  )
  winget install --id Python.Python.3.11 -e --source winget --accept-package-agreements --accept-source-agreements
  py -3.11 --version >nul 2>nul
  if errorlevel 1 (
    echo Python 3.11 no quedo disponible. Reinicia Windows y vuelve a ejecutar este instalador.
    pause
    exit /b 1
  )
)
echo Preparando el navegador seguro de WhatsApp. Puede tardar varios minutos la primera vez...
echo Descargando Playwright. No cierres esta ventana mientras haya reintentos.
py -3.11 -m pip install --disable-pip-version-check --quiet --no-cache-dir --index-url https://pypi.org/simple --timeout 120 --retries 8 playwright
if errorlevel 1 (
  echo No se pudo instalar Playwright. Revisa la conexion a Internet e intenta de nuevo.
  pause
  exit /b 1
)
py -3.11 -m playwright install chromium
if errorlevel 1 (
  echo No se pudo descargar Chromium para WhatsApp. Revisa la conexion a Internet e intenta de nuevo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$startup=[Environment]::GetFolderPath('Startup'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $startup 'Indoor Confeccion.lnk')); $s.TargetPath='wscript.exe'; $s.Arguments='\"C:\IndoorAgentes\Confeccion\iniciar_oculto.vbs\"'; $s.WorkingDirectory='C:\IndoorAgentes\Confeccion'; $s.WindowStyle=7; $s.Save()"
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "IndoorConfeccion" /t REG_SZ /d "wscript.exe \"C:\IndoorAgentes\Confeccion\iniciar_oculto.vbs\"" /f >nul
start "" wscript.exe "%DEST%\iniciar_oculto.vbs"
echo Agente de Confeccion instalado e iniciado en segundo plano en %DEST%.
echo En la primera preparacion se abrira WhatsApp Web en este PC para escanear el QR.
echo.
echo Pulsa una tecla para cerrar esta ventana.
pause >nul
exit /b 0
