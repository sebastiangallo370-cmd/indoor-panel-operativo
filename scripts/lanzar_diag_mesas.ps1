$py = 'C:\Users\Administrador\AppData\Local\IndoorBot_OrdenesVenta\venv\Scripts\python.exe'
$repo = 'C:\Users\Administrador\Documents\Codex\indoor-panel-operativo'
$maestro = '\\192.168.0.120\nas indoor\CLIENTES\SANTIAGO JARAMILLO CORREA\MAESTROS\CAMISETAS\CA00_D1_D2-\D2 CA00M XS A 4XL.ai'
$salida = "$repo\Claude outputs\diag_mesas.json"
if (-not (Test-Path -LiteralPath $maestro)) { Write-Output "NO EXISTE: $maestro"; exit 1 }
Remove-Item -LiteralPath $salida -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList @('-u', "`"$repo\scripts\diagnosticar_mesas_maestro.py`"", "`"$maestro`"", "`"$salida`"") -RedirectStandardOutput "$repo\Claude outputs\diag_mesas.log" -RedirectStandardError "$repo\Claude outputs\diag_mesas.err"
Write-Output 'lanzado'
