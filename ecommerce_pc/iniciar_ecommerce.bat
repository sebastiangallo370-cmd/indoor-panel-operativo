@echo off
rem Conecta este PC con ECOMMERCE del panel. Déjalo abierto (o usa iniciar_ecommerce_oculto.vbs).
cd /d "%~dp0"
python puente_ecommerce.py %*
pause
