# Alerta de pedidos nuevos en el PC: consulta cada minuto y muestra una notificación de Windows.
# No guarda ninguna contraseña: usa una clave de alerta en %USERPROFILE%\.indoor_alerta_token.
$ErrorActionPreference = 'SilentlyContinue'
$url = 'https://produccion.cloud/api/club/alertas/pendientes'
$tokenFile = Join-Path $env:USERPROFILE '.indoor_alerta_token'
$vistosFile = Join-Path $env:LOCALAPPDATA 'IndoorAlerta\vistos.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $vistosFile) | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icono = New-Object System.Windows.Forms.NotifyIcon
$icono.Icon = [System.Drawing.SystemIcons]::Information
$icono.Visible = $true
$primera = -not (Test-Path $vistosFile)
$vistos = @()
if (-not $primera) { $vistos = @(Get-Content $vistosFile | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }
while ($true) {
  try {
    $token = (Get-Content $tokenFile -Raw).Trim()
    $r = Invoke-RestMethod -Uri $url -Headers @{ 'X-Alerta-Token' = $token } -TimeoutSec 20
    foreach ($p in @($r.pedidos)) {
      if ($vistos -notcontains [int]$p.id) {
        $vistos += [int]$p.id
        if (-not $primera) {
          $icono.ShowBalloonTip(8000, 'Nuevo pedido de comercial', ("{0} · {1} prendas · reposición #{2}" -f $p.cliente, $p.prendas, $p.id), [System.Windows.Forms.ToolTipIcon]::Info)
        }
      }
    }
    $vistos | Set-Content $vistosFile
    $primera = $false
  } catch { }
  Start-Sleep -Seconds 60
}
