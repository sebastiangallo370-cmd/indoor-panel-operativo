@echo off
rem ECOMMERCE: enlaza ESTE PC con el panel (solo en el PC donde correran los agentes de Effi: ALMA, BRISA y CIRO).
rem En produccion.cloud: menu de usuario > Ecommerce > Conectar PC. Copia la direccion y el codigo y pegalos aqui.
title ECOMMERCE - enlazar con el panel
cd /d "%~dp0"
set "PY=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" puente_ecommerce.py --conectar
if exist "datos\panel.json" if exist "datos\sin_enlace.txt" del "datos\sin_enlace.txt"
echo.
echo Para que empiece a funcionar: detener_agentes.bat y luego iniciar_oculto.vbs (carpeta de arriba).
pause
