@echo off
set "NAS=\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\confeccion"
if not exist "%NAS%\confeccion_agente.py" exit /b 0
robocopy "%NAS%" "%~dp0" *.py *.vbs *.bat /XD datos logs __pycache__ /NJH /NJS /NP /R:1 /W:1 >nul
exit /b 0
