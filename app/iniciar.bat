@echo off
call "%~dp0actualizar_desde_nas.bat"
start "" wscript.exe "%~dp0iniciar_oculto.vbs"
