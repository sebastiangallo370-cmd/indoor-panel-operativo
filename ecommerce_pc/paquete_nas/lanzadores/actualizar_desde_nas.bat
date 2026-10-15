@echo off
rem Copia a este PC la ultima version del codigo desde la NAS (si la NAS no responde, se queda con la copia local).
set "NAS=\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
set "DESTINO=%~dp0"
if not exist "%NAS%\server.py" exit /b 0
for %%D in (agents core jsx web) do robocopy "%NAS%\%%D" "%DESTINO%%%D" /MIR /XD __pycache__ /NJH /NJS /NP /R:1 /W:1 >nul
robocopy "%NAS%" "%DESTINO%." *.py requirements.txt /NJH /NJS /NP /R:1 /W:1 >nul
rem ECOMMERCE: solo el codigo (no toca ecommerce\datos ni la cola de ordenes).
if exist "%NAS%\ecommerce" robocopy "%NAS%\ecommerce" "%DESTINO%ecommerce" *.py *.bat *.txt /XD datos cola __pycache__ /NJH /NJS /NP /R:1 /W:1 >nul
exit /b 0
