@echo off
setlocal
title Instalador Agente de Confeccion
set "DEST=C:\IndoorAgentes\Confeccion"
set "NAS=\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\confeccion"

if not exist "%NAS%\confeccion_agente.py" echo NAS no disponible; se conserva la copia local del agente.

if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%\logs" mkdir "%DEST%\logs"
if exist "%NAS%\confeccion_agente.py" robocopy "%NAS%" "%DEST%" *.py *.vbs *.bat /XD datos logs __pycache__ /NJH /NJS /NP /R:2 /W:2 >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$startup=[Environment]::GetFolderPath('Startup'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $startup 'Indoor Confeccion.lnk')); $s.TargetPath='wscript.exe'; $s.Arguments='\"C:\IndoorAgentes\Confeccion\iniciar_oculto.vbs\"'; $s.WorkingDirectory='C:\IndoorAgentes\Confeccion'; $s.WindowStyle=7; $s.Save()"
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "IndoorConfeccion" /t REG_SZ /d "wscript.exe \"C:\IndoorAgentes\Confeccion\iniciar_oculto.vbs\"" /f >nul
start "" wscript.exe "%DEST%\iniciar_oculto.vbs"
echo Agente de Confeccion instalado e iniciado en segundo plano.
exit /b 0
