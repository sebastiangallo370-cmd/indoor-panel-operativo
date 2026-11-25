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

function Huella {
    # Nombre, tamaño y fecha de cada archivo de codigo en la NAS: basta para saber si algo cambio
    Get-ChildItem "$Nas\agents", "$Nas\core", "$Nas\jsx", "$Nas\web" -Recurse -File -Include *.py, *.jsx, *.js, *.html -ErrorAction SilentlyContinue |
        Sort-Object FullName | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Out-String
}
function Anotar($t) { Add-Content -Path $LogVig -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $t) }

$previa = $null
Anotar "Vigilancia iniciada. NAS: $Nas"

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
    Start-Sleep -Seconds 40
}

while ($true) {
    try {
        if (Atascado) { ReiniciarServidor "Atasco detectado (sin actividad 15 min en mitad de una orden): reinicio el servidor para que siga."; $previa = Huella; continue }
        if (-not (Test-Path "$Nas\server.py")) { Anotar "NAS no disponible; reintento"; Start-Sleep -Seconds 60; continue }
        $ahora = Huella
        if ($previa -ne $null -and $ahora -ne $previa) {
            $idle = if (Test-Path $LogAg) { ((Get-Date) - (Get-Item $LogAg).LastWriteTime).TotalSeconds } else { 9999 }
            if ($idle -lt 120) {
                Anotar "Codigo nuevo en la NAS, pero hay una orden en curso; espero."
            } else {
                Anotar "Codigo nuevo en la NAS: reinicio el servidor de agentes."
                Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*server.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                Start-Sleep -Seconds 3
                Start-Process -FilePath "wscript.exe" -ArgumentList "`"$Local\iniciar_oculto.vbs`"" -WindowStyle Hidden
                Start-Sleep -Seconds 40
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
