# Publica el codigo de los agentes en la NAS y reinicia el servidor del PC SOLO cuando no hay una orden en curso.
# Uso (en el PC de los agentes):
#   powershell -ExecutionPolicy Bypass -File scripts\actualizar_agentes.ps1           # copia, valida y reinicia si esta libre
#   powershell -ExecutionPolicy Bypass -File scripts\actualizar_agentes.ps1 -SoloCopiar  # solo copia y valida (no reinicia)
#   powershell -ExecutionPolicy Bypass -File scripts\actualizar_agentes.ps1 -Forzar      # reinicia aunque haya una orden en curso (NO recomendado)
param([switch]$SoloCopiar, [switch]$Forzar)

$ErrorActionPreference = "Stop"
$Repo   = Split-Path -Parent $PSScriptRoot
$Src    = Join-Path $Repo "_agentes_indoor_actualizado_20261028\AGENTES_INDOOR\codigo"
$Nas    = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
$Backup = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\_respaldos_codigo\" + (Get-Date -Format "yyyyMMdd-HHmm")
$PcDir  = "C:\Users\Administrador\Desktop\agentes_uniformes"
$LogAg  = Join-Path $PcDir "logs\agentes.log"
$Carpetas = @("agents", "core", "jsx", "web")

# 1) Validar antes de publicar: si un .py no compila, no se publica nada
Push-Location $Src
try {
    foreach ($c in ($Carpetas | Where-Object { Test-Path $_ })) {
        Get-ChildItem $c -Recurse -Filter *.py | ForEach-Object { python -m py_compile $_.FullName | Out-Null; if ($LASTEXITCODE -ne 0) { throw "No compila: $($_.FullName)" } }
    }
    Get-ChildItem . -Filter *.py | ForEach-Object { python -m py_compile $_.FullName | Out-Null; if ($LASTEXITCODE -ne 0) { throw "No compila: $($_.FullName)" } }
} finally { Pop-Location }
Write-Output "Validacion OK (todo compila)."

# 2) Copiar a la NAS solo lo que cambio; el respaldo de lo anterior va a _respaldos_codigo (no ensucia la carpeta de los PC)
$cambiados = 0
$archivos = @()
foreach ($c in $Carpetas) { if (Test-Path (Join-Path $Src $c)) { $archivos += Get-ChildItem (Join-Path $Src $c) -Recurse -File -Include *.py,*.jsx } }
$archivos += Get-ChildItem $Src -File -Filter *.py
foreach ($f in $archivos) {
    $rel = $f.FullName.Substring($Src.Length).TrimStart("\")
    $destino = Join-Path $Nas $rel
    $igual = (Test-Path $destino) -and ((Get-FileHash $f.FullName).Hash -eq (Get-FileHash $destino).Hash)
    if ($igual) { continue }
    if (Test-Path $destino) {
        $bk = Join-Path $Backup $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $bk) | Out-Null
        Copy-Item $destino $bk -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
    Copy-Item $f.FullName $destino -Force
    $cambiados++
    Write-Output "Publicado: $rel"
}
Write-Output "Archivos publicados en la NAS: $cambiados (respaldo de lo anterior en $Backup)"

if ($SoloCopiar) { Write-Output "Solo copia: no reinicio el servidor."; exit 0 }

# 3) Reiniciar SOLO si no hay una orden en curso (el log no se mueve hace 2 minutos)
if (-not $Forzar) {
    $idle = ((Get-Date) - (Get-Item $LogAg).LastWriteTime).TotalSeconds
    if ($idle -lt 120) { Write-Output "Hay una orden en curso (el log se movio hace $([int]$idle) s). No reinicio; vuelve a correr el script cuando termine."; exit 2 }
}

# 4) Reinicio del servidor de agentes (arranca de nuevo desde la NAS)
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$PcDir\iniciar_oculto.vbs`"" -WindowStyle Hidden
Start-Sleep -Seconds 40
$vivo = Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" }
if ($vivo) { Write-Output "Servidor de agentes reiniciado con el codigo de la NAS." } else { Write-Output "ERROR: el servidor no aparece; revisa $PcDir\logs\servidor.txt"; exit 1 }
