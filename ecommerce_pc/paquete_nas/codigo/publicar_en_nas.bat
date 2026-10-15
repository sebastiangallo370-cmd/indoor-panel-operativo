@echo off
rem Sube el codigo de los agentes a la NAS. Los demas PC lo copian solos al iniciar los agentes.
rem NO sube datos, logs, credenciales, salidas, .venv ni los lanzadores (.bat/.vbs).
set "NAS=\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
set "ORIGEN=%~dp0"
for %%D in (agents core jsx web) do robocopy "%ORIGEN%%%D" "%NAS%\%%D" /MIR /XD __pycache__ /XF *.pyc /NJH /NJS /NP /R:2 /W:2
robocopy "%ORIGEN%." "%NAS%" *.py requirements.txt /NJH /NJS /NP /R:2 /W:2
rem ECOMMERCE: solo el codigo (sin datos ni la cola de ordenes).
if exist "%ORIGEN%ecommerce" robocopy "%ORIGEN%ecommerce" "%NAS%\ecommerce" *.py *.bat *.txt /XD datos cola __pycache__ /NJH /NJS /NP /R:2 /W:2
echo Publicado en la NAS.
