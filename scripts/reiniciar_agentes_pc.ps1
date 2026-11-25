# Reinicia los agentes de ESTE PC con el codigo nuevo de la NAS.
# Copiar a la carpeta local de agentes del PC (p. ej. C:\Users\Administrador\Desktop\agentes_uniformes) y ejecutar:
#   powershell -ExecutionPolicy Bypass -File .\reiniciar_agentes_pc.ps1
# Antes de reiniciar espera a que no haya una orden en curso (el log no se mueve hace 2 minutos); con -Forzar no espera.
param([switch]$Forzar)

$ErrorActionPreference = "Stop"
$Local = Split-Path -Parent $MyInvocation.MyCommand.Path
$Nas   = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
$LogAg = Join-Path $Local "logs\agentes.log"

if (-not (Test-Path "$Nas\server.py")) { Write-Output "ERROR: no veo la NAS ($Nas). No reinicio."; exit 1 }

# 1) Esperar a que no haya orden en curso
if (-not $Forzar -and (Test-Path $LogAg)) {
    $t0 = Get-Date
    while (((Get-Date) - (Get-Item $LogAg).LastWriteTime).TotalSeconds -lt 120) {
        if (((Get-Date) - $t0).TotalSeconds -gt 480) { Write-Output "Hay una orden en curso. No reinicio; vuelve a ejecutar cuando termine."; exit 2 }
        Start-Sleep -Seconds 15
    }
}

# 2) Traer el codigo nuevo de la NAS a la carpeta local (mismo proceso que iniciar.bat)
Copy-Item "$Nas\actualizar_desde_nas.bat" (Join-Path $Local "actualizar_desde_nas.bat") -Force
Copy-Item "$Nas\iniciar.bat" (Join-Path $Local "iniciar.bat") -Force -ErrorAction SilentlyContinue
cmd /c "`"$Local\actualizar_desde_nas.bat`"" | Out-Null
Write-Output "Codigo copiado desde la NAS."

# 3) Reiniciar el servidor de agentes
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$Local\iniciar_oculto.vbs`"" -WindowStyle Hidden
Start-Sleep -Seconds 40

# 4) Comprobar que el codigo que corre es el de la NAS
$vivo = Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" }
$ok = $true
foreach ($r in @("agents\olver.py", "agents\tavo.py", "jsx\GENERADOR_AGENTES.jsx")) {
    $igual = (Test-Path (Join-Path $Local $r)) -and ((Get-FileHash (Join-Path $Local $r)).Hash -eq (Get-FileHash (Join-Path $Nas $r)).Hash)
    Write-Output ("{0} igual a la NAS: {1}" -f $r, $igual)
    if (-not $igual) { $ok = $false }
}
if ($vivo -and $ok) { Write-Output "LISTO: agentes reiniciados con el codigo nuevo." } else { Write-Output "ERROR: revisa $Local\logs\servidor.txt"; exit 1 }
