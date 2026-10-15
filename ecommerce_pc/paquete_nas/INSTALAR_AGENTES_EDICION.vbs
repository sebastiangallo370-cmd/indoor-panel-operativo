' INSTALAR AGENTES EDICION  (instala o actualiza, deja la tarea programada y arranca todo)
' Doble clic. Pide permiso de administrador una sola vez (Windows muestra un aviso: pulsa SI).
' - Si los agentes ya estan instalados en este PC: reemplaza el codigo por el ultimo de la NAS.
' - Si no estan: instala Python (si falta), el entorno, las dependencias y la carpeta de CLIENTES.
' - Conecta el PC con el panel (te pide el codigo de AGENTES > Conectar PC, solo si aun no esta conectado).
' - Crea la tarea programada "Agentes Indoor" (arranca al iniciar sesion y se reintenta sola).
' - Arranca los agentes y muestra "Agentes_Edicion Ha Iniciado Correctamente".
' - Tambien instala ECOMMERCE (agentes de las ordenes de venta de Effi) en la subcarpeta ecommerce, con su entorno de Python.
' No toca datos, logs, credenciales ni salidas de este PC.
Option Explicit
Dim sh, fso, sa, args, usuario, perfil, i, a, prueba
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set sa = CreateObject("Shell.Application")

Const TITULO = "Agentes_Edicion"
Dim NAS
NAS = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR"

usuario = sh.ExpandEnvironmentStrings("%USERNAME%")
perfil = sh.ExpandEnvironmentStrings("%USERPROFILE%")
prueba = False
For i = 0 To WScript.Arguments.Count - 1
  a = WScript.Arguments(i)
  If LCase(Left(a, 3)) = "/u:" Then usuario = Mid(a, 4)
  If LCase(Left(a, 3)) = "/p:" Then perfil = Mid(a, 4)
  If LCase(a) = "/prueba" Then prueba = True
Next

' ---- 0. Permiso de administrador (necesario para la tarea programada) ----
If Not prueba Then
  If sh.Run("cmd /c net session >nul 2>&1", 0, True) <> 0 Then
    sa.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """ ""/u:" & usuario & """ ""/p:" & perfil & """", "", "runas", 1
    WScript.Quit 0
  End If
End If

If Not fso.FolderExists(NAS & "\codigo") Then
  Aviso "No puedo leer la NAS:" & vbCrLf & NAS & vbCrLf & "Revisa la conexion de red e intenta de nuevo.", 48
  WScript.Quit 1
End If

' ---- 1. Carpeta de instalacion ----
Dim instal, nueva, c
instal = "": nueva = False
For Each c In Array(fso.GetParentFolderName(WScript.ScriptFullName), perfil & "\Desktop\agentes_uniformes", "C:\AgentesIndoor", perfil & "\AgentesIndoor", "C:\agentes_uniformes")
  If instal = "" Then
    If fso.FileExists(c & "\.venv\Scripts\python.exe") And fso.FileExists(c & "\iniciar_oculto.vbs") Then instal = c
  End If
Next
If instal = "" Then instal = "C:\AgentesIndoor": nueva = True

If prueba Then
  Aviso "PRUEBA (no se cambia nada)" & vbCrLf & "Usuario: " & usuario & vbCrLf & "Instalacion: " & instal & vbCrLf & "Es nueva: " & nueva & vbCrLf & "NAS: " & NAS, 64
  WScript.Quit 0
End If

If Not fso.FolderExists(instal) Then fso.CreateFolder instal
If Not fso.FolderExists(instal & "\logs") Then fso.CreateFolder instal & "\logs"
Dim reg
reg = instal & "\logs\instalacion.txt"

' ---- 2. Detener los agentes que esten corriendo ----
Ejecutar "powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"""
WScript.Sleep 2500

' ---- 3. Codigo y lanzadores desde la NAS ----
Dim d
For Each d In Array("agents", "core", "jsx", "web")
  Ejecutar "robocopy """ & NAS & "\codigo\" & d & """ """ & instal & "\" & d & """ /MIR /XD __pycache__ /XF *.pyc /NJH /NJS /NP /R:2 /W:2"
Next
Ejecutar "robocopy """ & NAS & "\codigo"" """ & instal & """ *.py requirements.txt /NJH /NJS /NP /R:2 /W:2"
If fso.FolderExists(NAS & "\lanzadores") Then Ejecutar "robocopy """ & NAS & "\lanzadores"" """ & instal & """ *.vbs *.bat *.ps1 /NJH /NJS /NP /R:2 /W:2"

' ---- 3b. ECOMMERCE (agentes de las ordenes de venta de Effi): su codigo va en la MISMA carpeta, en "ecommerce" ----
If fso.FolderExists(NAS & "\codigo\ecommerce") Then
  Ejecutar "robocopy """ & NAS & "\codigo\ecommerce"" """ & instal & "\ecommerce"" *.py *.bat *.txt /XD datos cola __pycache__ /NJH /NJS /NP /R:2 /W:2"
  If Not fso.FolderExists(instal & "\ecommerce\datos") Then fso.CreateFolder instal & "\ecommerce\datos"
End If
If Not fso.FolderExists(instal & "\salidas") Then fso.CreateFolder instal & "\salidas"
If Not fso.FolderExists(instal & "\datos") Then fso.CreateFolder instal & "\datos"

' ---- 4. Python y entorno (solo si falta) ----
Dim py, venvPy
venvPy = instal & "\.venv\Scripts\python.exe"
If Not fso.FileExists(venvPy) Then
  py = BuscarPython()
  If py = "" Then
    Aviso "Falta Python en este PC. Se va a instalar (puede tardar unos minutos). Pulsa Aceptar y espera.", 64
    Ejecutar "winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements"
    py = BuscarPython()
  End If
  If py = "" Then
    Aviso "Python quedo instalado pero Windows aun no lo reconoce." & vbCrLf & "Cierra esto y vuelve a ejecutar INSTALAR_AGENTES_EDICION.vbs.", 48
    WScript.Quit 1
  End If
  Ejecutar """" & py & """ -m venv """ & instal & "\.venv"""
End If
If Not fso.FileExists(venvPy) Then
  Aviso "No se pudo crear el entorno de Python. Revisa: " & reg, 48
  WScript.Quit 1
End If
Ejecutar """" & venvPy & """ -m pip install --upgrade pip"
If Ejecutar("""" & venvPy & """ -m pip install -r """ & instal & "\requirements.txt""") <> 0 Then
  Aviso "Fallo la instalacion de dependencias. Revisa la conexion a internet y el archivo: " & reg, 48
  WScript.Quit 1
End If

' ---- 4b. ECOMMERCE: entorno de Python de las ordenes de venta (selenium, pdfplumber, gspread, pywin32...) ----
Dim reqOV, venvOV
reqOV = fso.GetParentFolderName(NAS) & "\Automatizacion\AUTOMATIZACION_PAGINA WEB\BOT_ORDENES_VENTA\requirements.txt"
If fso.FolderExists(instal & "\ecommerce") And fso.FileExists(reqOV) Then
  venvOV = perfil & "\AppData\Local\IndoorBot_OrdenesVenta\venv"
  If Not fso.FileExists(venvOV & "\Scripts\python.exe") Then Ejecutar """" & venvPy & """ -m venv """ & venvOV & """"
  If fso.FileExists(venvOV & "\Scripts\python.exe") Then Ejecutar """" & venvOV & "\Scripts\python.exe"" -m pip install -r """ & reqOV & """"
End If

' ---- 5. Carpeta CLIENTES de la NAS ----
Dim clientes
clientes = ""
For Each c In Array("Z:\CLIENTES", "\\192.168.0.120\nas indoor\CLIENTES")
  If clientes = "" Then
    If fso.FolderExists(c) Then clientes = c
  End If
Next
If clientes = "" Then clientes = InputBox("No encuentro la NAS (CLIENTES) desde este PC." & vbCrLf & "Conecta la unidad de red y escribe la ruta, por ejemplo Z:\CLIENTES", TITULO, "Z:\CLIENTES")
If clientes <> "" Then Ejecutar """" & venvPy & """ """ & instal & "\configurar_instalacion.py"" ordenes """ & clientes & """"

' ---- 6. Conexion con el panel (solo si aun no esta conectado) ----
Dim panelOk, codigo
panelOk = fso.FileExists(instal & "\datos\panel.json")
If Not panelOk Then
  codigo = InputBox("Conectar este PC al panel Indoor." & vbCrLf & vbCrLf & "En produccion.cloud entra a AGENTES, pulsa ""Conectar PC"" y pega aqui el codigo." & vbCrLf & "(Si lo dejas vacio, los agentes arrancan pero no atienden el panel.)", TITULO, "")
  If Trim(codigo) <> "" Then
    Ejecutar """" & venvPy & """ """ & instal & "\configurar_instalacion.py"" panel """ & Trim(codigo) & """"
    panelOk = fso.FileExists(instal & "\datos\panel.json")
  End If
End If

' ---- 6b. ECOMMERCE: conexion con el panel (solo en el PC donde correran los agentes de Effi) ----
Dim ecomOk, codEcom, mc
ecomOk = fso.FileExists(instal & "\ecommerce\datos\panel.json")
If fso.FileExists(instal & "\ecommerce\puente_ecommerce.py") And Not ecomOk Then
  codEcom = InputBox("ECOMMERCE (ordenes de venta de Effi): conectar ESTE PC con el panel." & vbCrLf & vbCrLf & "Hazlo SOLO en el PC donde correran ALMA, BRISA y CIRO (el panel atiende un solo PC)." & vbCrLf & "En produccion.cloud: menu de usuario > Ecommerce > Conectar PC, y pega aqui el codigo." & vbCrLf & "(Vacio = no conectarlo; despues se hace con ecommerce\ENLAZAR_ECOMMERCE.bat)", TITULO)
  If Trim(codEcom) <> "" Then
    Ejecutar """" & venvPy & """ """ & instal & "\configurar_instalacion.py"" ecommerce """ & Trim(codEcom) & """"
    ecomOk = fso.FileExists(instal & "\ecommerce\datos\panel.json")
  End If
  If Not ecomOk Then
    If Not fso.FolderExists(instal & "\ecommerce\datos") Then fso.CreateFolder instal & "\ecommerce\datos"
    Set mc = fso.CreateTextFile(instal & "\ecommerce\datos\sin_enlace.txt", True)
    mc.Close
  End If
End If

' ---- 7. Tarea programada "Agentes Indoor" (al iniciar sesion, con reintentos) ----
Dim tareaOk, destino
destino = perfil & "\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Agentes Indoor.vbs"
Ejecutar "powershell -NoProfile -ExecutionPolicy Bypass -File """ & instal & "\crear_tarea.ps1"" -Carpeta """ & instal & """ -Usuario """ & usuario & """"
tareaOk = (sh.Run("cmd /c schtasks /query /tn ""Agentes Indoor"" >nul 2>&1", 0, True) = 0)
If tareaOk Then
  If fso.FileExists(destino) Then fso.DeleteFile destino, True
Else
  Dim t
  Set t = fso.CreateTextFile(destino, True)
  t.WriteLine "CreateObject(""WScript.Shell"").Run ""wscript.exe """"" & instal & "\iniciar_oculto.vbs"""""", 0, False"
  t.Close
End If

' ---- 7b. Boton "Abrir en Illustrator" del panel: se registra el protocolo indoor-ai: para todos los usuarios de este PC ----
Dim regf, tr
regf = fso.GetSpecialFolder(2) & "\indoor_ai.reg"
Set tr = fso.CreateTextFile(regf, True)
tr.WriteLine "Windows Registry Editor Version 5.00"
tr.WriteLine ""
tr.WriteLine "[HKEY_LOCAL_MACHINE\SOFTWARE\Classes\indoor-ai]"
tr.WriteLine "@=""URL:Indoor Illustrator"""
tr.WriteLine """URL Protocol""="""""
tr.WriteLine ""
tr.WriteLine "[HKEY_LOCAL_MACHINE\SOFTWARE\Classes\indoor-ai\shell\open\command]"
tr.WriteLine "@=" & Chr(34) & "wscript.exe " & Chr(92) & Chr(34) & Replace(instal, Chr(92), Chr(92) & Chr(92)) & Chr(92) & Chr(92) & "abrir_en_illustrator.vbs" & Chr(92) & Chr(34) & " " & Chr(92) & Chr(34) & "%1" & Chr(92) & Chr(34) & Chr(34)
tr.Close
Ejecutar "reg import """ & regf & """"
fso.DeleteFile regf, True

' ---- 8. Arrancar (el aviso "Ha Iniciado Correctamente" lo muestra el propio programa) ----
' IMPORTANTE: se arranca SIN permisos de administrador (como tu usuario): si corre elevado, no puede hablar con el Illustrator que abres tu.
' Se abre con el Explorador de Windows: lo lanza SIN administrador (aunque este instalador si lo tenga) y asi el agente ve tu Illustrator.
sa.ShellExecute "explorer.exe", """" & instal & "\iniciar_oculto.vbs""", "", "open", 0

Dim res
res = "Agentes_Edicion " & IIf(nueva, "instalado", "actualizado") & " en:" & vbCrLf & instal & vbCrLf & vbCrLf
res = res & IIf(tareaOk, "- Tarea programada ""Agentes Indoor"": creada (arranca al iniciar sesion).", "- Tarea programada: no se pudo crear; quedo el arranque por la carpeta Inicio de Windows.") & vbCrLf
res = res & IIf(panelOk, "- Panel: conectado.", "- Panel: SIN conectar (vuelve a ejecutar este archivo y pega el codigo).") & vbCrLf
If fso.FolderExists(instal & "\ecommerce") Then res = res & IIf(ecomOk, "- ECOMMERCE: conectado (aparece como Ecommerce en el menu de usuario del panel).", "- ECOMMERCE: instalado pero SIN conectar a este PC (ecommerce\ENLAZAR_ECOMMERCE.bat).") & vbCrLf
res = res & vbCrLf
res = res & "En unos segundos aparecera el aviso ""Agentes_Edicion Ha Iniciado Correctamente""."
Aviso res, 64

' ================== funciones ==================
Function IIf(cond, a, b)
  If cond Then IIf = a Else IIf = b
End Function

Sub Aviso(texto, icono)
  sh.Popup texto, 0, TITULO, icono
End Sub

Function Ejecutar(cmd)
  Dim log
  log = instal & "\logs\instalacion.txt"
  Ejecutar = sh.Run("cmd /c """ & cmd & " >> """ & log & """ 2>&1""", 0, True)
End Function

Function BuscarPython()
  Dim p, o, ruta, cand
  BuscarPython = ""
  For Each p In Array("py -3", "python")
    On Error Resume Next
    Set o = sh.Exec("cmd /c " & p & " -c ""import sys;print(sys.executable)"" 2>nul")
    ruta = ""
    If Err.Number = 0 Then ruta = Trim(o.StdOut.ReadAll)
    Err.Clear
    On Error GoTo 0
    ruta = Replace(Replace(ruta, vbCr, ""), vbLf, "")
    If ruta <> "" And BuscarPython = "" Then
      If fso.FileExists(ruta) Then BuscarPython = ruta
    End If
  Next
  If BuscarPython = "" Then
    For Each cand In Array(perfil & "\AppData\Local\Programs\Python\Python312\python.exe", "C:\Program Files\Python312\python.exe")
      If BuscarPython = "" Then
        If fso.FileExists(cand) Then BuscarPython = cand
      End If
    Next
  End If
End Function
