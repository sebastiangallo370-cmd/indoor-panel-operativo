' Arranca el puente de ECOMMERCE en segundo plano (sin ventana negra).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c python puente_ecommerce.py >> puente.log 2>&1", 0, False
