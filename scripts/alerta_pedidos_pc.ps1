# Alerta de pedidos en el PC: espera la señal del servidor (cuando un comercial da clic en PROGRAMAR)
# y muestra una notificación de Windows. Usa una sola consulta abierta, no consulta cada minuto.
# La clave de alerta está en %USERPROFILE%\.indoor_alerta_token (no hay contraseñas en este archivo).
$ErrorActionPreference = 'SilentlyContinue'
$base = 'https://produccion.cloud/api/club/alertas/esperar'
$tokenFile = Join-Path $env:USERPROFILE '.indoor_alerta_token'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icono = New-Object System.Windows.Forms.NotifyIcon
$icono.Icon = [System.Drawing.SystemIcons]::Information
$icono.Visible = $true
$version = -1
$primera = $true
while ($true) {
  try {
    $token = (Get-Content $tokenFile -Raw).Trim()
    $r = Invoke-RestMethod -Uri ("{0}?desde={1}" -f $base, $version) -Headers @{ 'X-Alerta-Token' = $token } -TimeoutSec 70
    if ($r.version -gt $version) {
      $version = [int]$r.version
      if (-not $primera -and $r.evento) {
        $e = $r.evento
        $texto = "{0} · {1} prendas" -f $e.cliente, $e.prendas
        if ($e.proyecto) { $texto += " · " + $e.proyecto }
        $aviso = Join-Path $env:LOCALAPPDATA 'IndoorAlertaviso_pc.ps1'
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`" -Titulo 'Un comercial está programando un pedido' -Texto `"{1}`"" -f $aviso, $texto)
      }
    }
    $primera = $false
  } catch {
    Start-Sleep -Seconds 30
  }
}
