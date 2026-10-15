' Arranca los agentes en segundo plano: sin ventana negra y sin abrir el navegador.
' Todo se usa desde AGENTES en el panel (produccion.tech). Los mensajes de error quedan en logs\servidor.txt.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(".venv\Scripts\python.exe") Then
  MsgBox "Primero ejecuta instalar.bat", 48, "Agentes Indoor"
  WScript.Quit 1
End If
' El codigo se ejecuta DIRECTO desde la NAS (carpeta de GALLO); datos, logs, credenciales y salidas quedan en este PC.
' Si la NAS no responde, usa la copia local del codigo (la ultima que se sincronizo).
nas = "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\codigo"
local = sh.CurrentDirectory
servidor = "server.py"
If fso.FileExists(nas & "\server.py") Then
  servidor = """" & nas & "\server.py"""
  If fso.FileExists("actualizar_desde_nas.bat") Then sh.Run "cmd /c actualizar_desde_nas.bat", 0, True
End If
sh.Run "cmd /c ""set AGENTES_LOCAL=" & local & "&& set PYTHONDONTWRITEBYTECODE=1&& .venv\Scripts\python.exe " & servidor & " >> logs\servidor.txt 2>&1""", 0, False

' --- ECOMMERCE (bots de Effi): arranca junto con los agentes de edicion, desde la carpeta "ecommerce" de aqui mismo.
' La primera vez pide la direccion del panel y el codigo (panel > menu de usuario > Ecommerce > Conectar PC).
If fso.FileExists("ecommerce\puente_ecommerce.py") Then
  If Not fso.FileExists("ecommerce\datos\panel.json") And Not fso.FileExists("ecommerce\datos\sin_enlace.txt") Then
    url = InputBox("ECOMMERCE - primera vez en este PC." & vbCrLf & "Direccion del panel:", "ECOMMERCE", "https://produccion.cloud")
    If url <> "" Then
      cod = InputBox("En el panel: menu de usuario > Ecommerce > Conectar PC." & vbCrLf & "Pega aqui el codigo:", "ECOMMERCE")
      If cod <> "" Then
        If Not fso.FolderExists("ecommerce\datos") Then fso.CreateFolder "ecommerce\datos"
        Set f = fso.CreateTextFile("ecommerce\datos\panel.json", True)
        f.Write "{""url"": """ & Trim(url) & """, ""token"": """ & Trim(cod) & """}"
        f.Close
      End If
    End If
    If Not fso.FileExists("ecommerce\datos\panel.json") Then
      If Not fso.FolderExists("ecommerce\datos") Then fso.CreateFolder "ecommerce\datos"
      fso.CreateTextFile("ecommerce\datos\sin_enlace.txt", True).Close
    End If
  End If
  If fso.FileExists("ecommerce\datos\panel.json") Then
    sh.Run "cmd /c "".venv\Scripts\python.exe ecommerce\puente_ecommerce.py >> logs\ecommerce.txt 2>&1""", 0, False
  End If
End If
