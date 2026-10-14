@echo off
rem Enlaza este PC con el panel: pega la dirección y el código que muestra ECOMMERCE → «Conectar PC».
cd /d "%~dp0"
python puente_ecommerce.py --conectar
pause
