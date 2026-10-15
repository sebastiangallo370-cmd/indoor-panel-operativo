@echo off
rem Detiene los agentes que corren en segundo plano (el programa que escucha en el puerto 8000).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
rem ECOMMERCE (ALMA, BRISA y CIRO y su puente) se detiene junto con los agentes de edicion.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'puente_ecommerce|agente_ov' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }"
echo Agentes detenidos (edicion y ECOMMERCE). Para volver a iniciarlos usa iniciar_oculto.vbs (doble clic): arranca los dos.
pause
