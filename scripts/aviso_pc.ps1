# Muestra un aviso en la esquina de la pantalla, arriba de las demás ventanas, durante 60 segundos (o hasta cerrarlo).
param([string]$Titulo = 'Aviso', [string]$Texto = '')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'
$f.StartPosition = 'Manual'
$f.TopMost = $true
$f.ShowInTaskbar = $false
$f.BackColor = [System.Drawing.Color]::FromArgb(20, 30, 22)
$f.Width = 380
$f.Height = 120
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$f.Location = New-Object System.Drawing.Point(($area.Right - $f.Width - 16), ($area.Bottom - $f.Height - 16))
$t1 = New-Object System.Windows.Forms.Label
$t1.Text = $Titulo
$t1.ForeColor = [System.Drawing.Color]::FromArgb(208, 244, 76)
$t1.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$t1.Location = New-Object System.Drawing.Point(14, 12)
$t1.AutoSize = $true
$t2 = New-Object System.Windows.Forms.Label
$t2.Text = $Texto
$t2.ForeColor = [System.Drawing.Color]::White
$t2.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$t2.Location = New-Object System.Drawing.Point(14, 40)
$t2.Size = New-Object System.Drawing.Size(350, 40)
$boton = New-Object System.Windows.Forms.Button
$boton.Text = 'Cerrar'
$boton.Location = New-Object System.Drawing.Point(280, 84)
$boton.Add_Click({ $f.Close() })
$f.Controls.AddRange(@($t1, $t2, $boton))
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60000
$timer.Add_Tick({ $f.Close() })
$timer.Start()
[void]$f.ShowDialog()
