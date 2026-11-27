# Vigila el codigo de los agentes en la NAS y reinicia el servidor de ESTE PC cuando cambia algo,
# pero SOLO si no hay una orden en curso (el log no se mueve hace 2 minutos).
# Asi el PC siempre corre el codigo de la NAS, igual que una extension de Chrome que se actualiza sola.
# Uso: powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File .\vigilar_codigo_agentes.ps1
# Para que arranque con Windows: poner un acceso directo a este comando en la carpeta shell:startup.
$ErrorActionPreference = "Continue"
$Local = Split-Path -Parent $MyInvocation.MyCommand.Path
$Nas   = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
$LogAg = Join-Path $Local "logs\agentes.log"
$LogVig = Join-Path $Local "logs\vigilancia.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $LogVig) | Out-Null

# Espera solo lo necesario: hasta que el servidor de agentes responde en el puerto 8000 (máximo 40 s)
function Esperar-Servidor {
    for ($i = 0; $i -lt 40; $i++) {
        try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { return } } catch { }
        Start-Sleep -Seconds 1
    }
}

function Huella {
    # Nombre, tamaño y fecha de cada archivo de codigo en la NAS: basta para saber si algo cambio
    Get-ChildItem "$Nas\agents", "$Nas\core", "$Nas\jsx", "$Nas\web" -Recurse -File -Include *.py, *.jsx, *.js, *.html -ErrorAction SilentlyContinue |
        Sort-Object FullName | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Out-String
}
# Latido al panel (con el token del PC, de datos\panel.json): así el panel muestra que el vigilante está activo
function LatidoPanel {
    try {
        $cfg = Get-Content (Join-Path $Local "datos\panel.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        $ver = (Get-Item (Join-Path $Local "vigilar_codigo_agentes.ps1")).LastWriteTime.ToString("yyyyMMdd-HHmm")
        $body = @{ equipo = $env:COMPUTERNAME; version = $ver } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri ($cfg.url.TrimEnd("/") + "/api/agentes/pc/vigilante") -Method Post -Headers @{ "X-Agentes-Token" = $cfg.token } -Body $body -ContentType "application/json" -TimeoutSec 15 | Out-Null
    } catch { }
}
function Anotar($t) { Add-Content -Path $LogVig -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $t) }

# Un solo vigilante por PC: cierra cualquier copia anterior (incluidas las que no escriben latido)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*vigilar_codigo_agentes*" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Latido en la NAS: un archivo por PC con la hora de la última revisión (para verificar desde cualquier lugar)
$Latidos = Join-Path $Nas "latidos"
function Latir {
    try {
        New-Item -ItemType Directory -Force -Path $Latidos | Out-Null
        # Hora de arranque del servidor de agentes en este PC: así el panel muestra si ya carga el código nuevo
        $srv = Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | Select-Object -First 1
        $arranque = if ($srv) { $srv.CreationDate.ToString("yyyy-MM-dd HH:mm:ss") } else { "sin servidor" }
        Set-Content -Path (Join-Path $Latidos "$env:COMPUTERNAME.txt") -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " vigilante activo | servidor arrancó: " + $arranque) -Encoding UTF8
    } catch {}
}

$previa = $null
Anotar "Vigilancia iniciada. NAS: $Nas"

# Al arrancar el PC (o el vigilante): si el servidor de agentes no corre, lo arranca
$vivoAlInicio = Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" }
if (-not $vivoAlInicio -and (Test-Path "$Nas\server.py")) {
    Anotar "El servidor de agentes no estaba corriendo: lo arranco con el codigo de la NAS."
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$Local\iniciar_oculto.vbs`"" -WindowStyle Hidden
    Esperar-Servidor
}

# Atasco: el log lleva mas de 15 min sin moverse en MITAD de una orden (no esperando una respuesta ni ya terminada) -> reinicio
function Atascado {
    if (-not (Test-Path $LogAg)) { return $false }
    $idle = ((Get-Date) - (Get-Item $LogAg).LastWriteTime).TotalSeconds
    if ($idle -lt 900) { return $false }
    $ultima = (Get-Content $LogAg -Tail 1 -Encoding UTF8 -ErrorAction SilentlyContinue | Out-String).Trim()
    if ($ultima -match "Sesión reiniciada|terminad|Detenido|cancel|pregunto|Esperando|espero|Revisar|confirm|Te toca|finalizad") { return $false }
    return $true
}
function ReiniciarServidor($motivo) {
    Anotar $motivo
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$Local\iniciar_oculto.vbs`"" -WindowStyle Hidden
    Esperar-Servidor
}

while ($true) {
    Latir
    LatidoPanel
    try {
        if (Atascado) { ReiniciarServidor "Atasco detectado (sin actividad 15 min en mitad de una orden): reinicio el servidor para que siga."; $previa = Huella; continue }
        if (-not (Test-Path "$Nas\server.py")) { Anotar "NAS no disponible; reintento"; Start-Sleep -Seconds 60; continue }
        $ahora = Huella
        if ($previa -ne $null -and $ahora -ne $previa) {
            $idle = if (Test-Path $LogAg) { ((Get-Date) - (Get-Item $LogAg).LastWriteTime).TotalSeconds } else { 9999 }
            if ($idle -lt 120) {
                Anotar "Codigo nuevo en la NAS, pero hay una orden en curso; espero."
                # NO se actualiza $previa: así en la próxima vuelta sigue viendo el código nuevo y reinicia apenas el PC quede libre
                # (antes se olvidaba del cambio y el PC se quedaba con el código viejo hasta el siguiente cambio)
                Start-Sleep -Seconds 60
                continue
            } else {
                Anotar "Codigo nuevo en la NAS: reinicio el servidor de agentes."
                Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                Start-Sleep -Seconds 3
                Start-Process -FilePath "wscript.exe" -ArgumentList "`"$Local\iniciar_oculto.vbs`"" -WindowStyle Hidden
                Esperar-Servidor
                $previa = Huella   # ya quedo con el codigo nuevo
                Anotar "Servidor reiniciado con el codigo de la NAS."
                continue
            }
        }
        if ($previa -eq $null) { Anotar "Primera revision: codigo de la NAS registrado." }
        $previa = $ahora
    } catch { Anotar "Error: $($_.Exception.Message)" }
    Start-Sleep -Seconds 60
}
