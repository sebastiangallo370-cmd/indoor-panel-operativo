# Abre en Adobe Illustrator (de ESTE PC) lo que se pide desde el panel:
#   indoor-ai://abrir/?ruta=<ruta de un PDF o .ai>                                  -> un archivo
#   indoor-ai://abrir/?carpetas=<carpeta1|carpeta2>&prefijo=CO6156_[&recursivo=1]   -> todos los PDF de la orden (los que empiezan por el prefijo)
param([string]$Uri)
Add-Type -AssemblyName System.Windows.Forms
$log = Join-Path $env:TEMP 'abrir_en_illustrator.log'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IndoorVentana {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
}
"@ -ErrorAction SilentlyContinue

function Get-VentanaIllustrator {
    Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
}

function Mostrar-IllustratorAlFrente {
    # Windows no deja que un proceso en segundo plano robe el foco. Se combinan: tecla Alt, enlace de hilos de entrada, SwitchToThisWindow,
    # AppActivate por PID y el truco de «siempre arriba» (que lo sube sobre el navegador aunque Windows no le dé el foco de teclado).
    $p = Get-VentanaIllustrator
    if (-not $p) { return $false }
    $h = $p.MainWindowHandle
    $listo = { [IndoorVentana]::GetForegroundWindow() -eq $h }
    if ([IndoorVentana]::IsIconic($h)) { [void][IndoorVentana]::ShowWindow($h, 9) } else { [void][IndoorVentana]::ShowWindow($h, 5) }   # 9 = restaurar, 5 = mostrar
    [void][IndoorVentana]::AllowSetForegroundWindow(-1)
    [IndoorVentana]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)      # Alt abajo
    [IndoorVentana]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)      # Alt arriba: Windows nos deja cambiar de ventana
    $actual = [IndoorVentana]::GetForegroundWindow()
    $pidAct = 0
    $hiloAct = [IndoorVentana]::GetWindowThreadProcessId($actual, [ref]$pidAct)
    $hiloYo = [IndoorVentana]::GetCurrentThreadId()
    if ($hiloAct -ne $hiloYo) { [void][IndoorVentana]::AttachThreadInput($hiloYo, $hiloAct, $true) }
    [void][IndoorVentana]::BringWindowToTop($h)
    [void][IndoorVentana]::SetForegroundWindow($h)
    if ($hiloAct -ne $hiloYo) { [void][IndoorVentana]::AttachThreadInput($hiloYo, $hiloAct, $false) }
    Start-Sleep -Milliseconds 120
    if (-not (& $listo)) { [IndoorVentana]::SwitchToThisWindow($h, $true); Start-Sleep -Milliseconds 120 }
    if (-not (& $listo)) { try { [void](New-Object -ComObject WScript.Shell).AppActivate([int]$p.Id) } catch {}; Start-Sleep -Milliseconds 120 }
    if (-not (& $listo)) {   # último recurso: subir la ventana por encima de todas y soltarla (queda al frente)
        [void][IndoorVentana]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0043)
        [void][IndoorVentana]::SetWindowPos($h, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0043)
        [void][IndoorVentana]::SetForegroundWindow($h)
        Start-Sleep -Milliseconds 120
    }
    return (& $listo)
}

function Poner-AlFrente {
    for ($i = 0; $i -lt 12; $i++) { if (Mostrar-IllustratorAlFrente) { return $true }; Start-Sleep -Milliseconds 400 }
    return $false
}

try {
    "$(Get-Date -Format s) uri=$Uri" | Out-File $log -Append -Encoding utf8
    $q = $Uri -replace '^indoor-ai:/*[^?]*\?', ''
    $ruta = $null; $carpetas = $null; $prefijo = ''; $recursivo = $false
    foreach ($par in $q.Split('&')) {
        if ($par -like 'ruta=*') { $ruta = [uri]::UnescapeDataString($par.Substring(5)) }
        elseif ($par -like 'carpetas=*') { $carpetas = [uri]::UnescapeDataString($par.Substring(9)) }
        elseif ($par -like 'prefijo=*') { $prefijo = [uri]::UnescapeDataString($par.Substring(8)) }
        elseif ($par -eq 'recursivo=1') { $recursivo = $true }
    }
    # solo se abren PDF y .ai que estén en la NAS de Indoor (o su unidad de red)
    $rutaValida = '^(\\\\192\.168\.0\.120\\|[A-Za-z]:\\)[^<>|"?*]+$'
    $archivos = @()
    if ($carpetas) {
        if ($prefijo -notmatch '^[A-Za-z0-9_-]{1,40}$') { throw 'El código de la orden no es válido.' }
        foreach ($c in ($carpetas -split '\|')) {
            $c = $c.Trim()
            if (-not $c) { continue }
            if ($c -notmatch $rutaValida -or $c -match '\.\.') { throw "La carpeta no es válida:`n$c" }
            if (-not (Test-Path -LiteralPath $c -PathType Container)) { continue }
            $archivos += Get-ChildItem -LiteralPath $c -Filter '*.pdf' -File -Recurse:$recursivo -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$prefijo*" } | ForEach-Object { $_.FullName }
        }
        $archivos = @($archivos | Sort-Object -Unique)
        if ($archivos.Count -eq 0) { throw "No encontré PDF de la orden $prefijo en las carpetas de salida." }
        if ($archivos.Count -gt 400) { throw "Son $($archivos.Count) PDF: son demasiados para abrirlos a la vez." }
        if ($archivos.Count -gt 40) {
            $r = [System.Windows.Forms.MessageBox]::Show("Se van a abrir $($archivos.Count) PDF en Illustrator a la vez. Puede tardar varios minutos.`n`n¿Continuar?", 'Indoor', 'YesNo', 'Question')
            if ($r -ne 'Yes') { return }
        }
    } else {
        if (-not $ruta -or $ruta -notmatch ($rutaValida.TrimEnd('$') + '\.(pdf|ai)$')) { throw 'La ruta del archivo no es válida.' }
        if (-not (Test-Path -LiteralPath $ruta)) { throw "No encuentro el archivo:`n$ruta" }
        $archivos = @($ruta)
    }
    if ($env:INDOOR_AI_SECO) { "$(Get-Date -Format s) SECO: $($archivos.Count) archivo(s)`n" + ($archivos -join "`n") | Out-File $log -Append -Encoding utf8; return }   # modo de prueba: solo lista, no abre nada
    $ai = New-Object -ComObject Illustrator.Application
    Start-Sleep -Milliseconds 700                  # deja que el navegador termine de lanzar el programa antes de pedir el primer plano
    [void](Poner-AlFrente)                         # si Illustrator ya estaba abierto, se ve de inmediato mientras abre los archivos
    $n = 0
    foreach ($archivo in $archivos) {
        $null = $ai.Open($archivo)
        $n++
        if ($n -eq 1 -or $n % 10 -eq 0) { [void](Poner-AlFrente) }   # se vuelve a pedir tras el primero y cada 10 archivos
    }
    $frente = Poner-AlFrente
    "$(Get-Date -Format s) abiertos=$n frente=$frente" | Out-File $log -Append -Encoding utf8
} catch {
    "$(Get-Date -Format s) ERROR: $($_.Exception.Message)" | Out-File $log -Append -Encoding utf8
    [System.Windows.Forms.MessageBox]::Show("No pude abrirlo en Illustrator.`n`n" + $_.Exception.Message, 'Indoor') | Out-Null
}
