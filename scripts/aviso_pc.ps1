# Aviso con el estilo de Indoor: esquina de la pantalla, por encima de las demás ventanas, 60 segundos (o hasta cerrarlo).
param([string]$Titulo = 'Aviso', [string]$Texto = '')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$verde = [System.Drawing.Color]::FromArgb(11, 18, 13)
$panel = [System.Drawing.Color]::FromArgb(23, 32, 26)
$lima = [System.Drawing.Color]::FromArgb(208, 244, 76)
$blanco = [System.Drawing.Color]::FromArgb(241, 246, 238)
$gris = [System.Drawing.Color]::FromArgb(169, 181, 163)

function Redondear($ctl, [int]$r) {
  $ruta = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w = $ctl.Width; $h = $ctl.Height; $d = $r * 2
  $ruta.AddArc(0, 0, $d, $d, 180, 90)
  $ruta.AddArc($w - $d, 0, $d, $d, 270, 90)
  $ruta.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  $ruta.AddArc(0, $h - $d, $d, $d, 90, 90)
  $ruta.CloseFigure()
  $ctl.Region = New-Object System.Drawing.Region($ruta)
}

$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'
$f.StartPosition = 'Manual'
$f.TopMost = $true
$f.ShowInTaskbar = $false
$f.BackColor = $verde
$f.Width = 400
$f.Height = 150
$f.Opacity = 0.97
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$f.Location = New-Object System.Drawing.Point(($area.Right - $f.Width - 20), ($area.Bottom - $f.Height - 20))
Redondear $f 16

$tarjeta = New-Object System.Windows.Forms.Panel
$tarjeta.Location = New-Object System.Drawing.Point(0, 0)
$tarjeta.Size = New-Object System.Drawing.Size($f.Width, $f.Height)
$tarjeta.BackColor = $panel
Redondear $tarjeta 16

$marca = New-Object System.Windows.Forms.Label
$marca.Text = 'INDOOR · PANEL'
$marca.ForeColor = $gris
$marca.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$marca.Location = New-Object System.Drawing.Point(18, 12)
$marca.AutoSize = $true

$t1 = New-Object System.Windows.Forms.Label
$t1.Text = $Titulo
$t1.ForeColor = $lima
$t1.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$t1.Location = New-Object System.Drawing.Point(18, 30)
$t1.Size = New-Object System.Drawing.Size(360, 26)

$t2 = New-Object System.Windows.Forms.Label
$t2.Text = $Texto
$t2.ForeColor = $blanco
$t2.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$t2.Location = New-Object System.Drawing.Point(18, 60)
$t2.Size = New-Object System.Drawing.Size(360, 40)

function Boton($texto, $x, $fondo, $colorTexto) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $texto
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.BackColor = $fondo
  $b.ForeColor = $colorTexto
  $b.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
  $b.Size = New-Object System.Drawing.Size(120, 34)
  $b.Location = New-Object System.Drawing.Point($x, 104)
  $b.Cursor = 'Hand'
  Redondear $b 17
  return $b
}
$abrir = Boton 'Abrir panel' 180 $lima $verde
$abrir.Add_Click({ Start-Process 'https://produccion.cloud/' ; $f.Close() })
$cerrar = Boton 'Cerrar' 306 ([System.Drawing.Color]::FromArgb(45, 58, 48)) $blanco
$cerrar.Add_Click({ $f.Close() })

$tarjeta.Controls.AddRange(@($marca, $t1, $t2, $abrir, $cerrar))
$f.Controls.Add($tarjeta)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60000
$timer.Add_Tick({ $f.Close() })
$timer.Start()
[void]$f.ShowDialog()
