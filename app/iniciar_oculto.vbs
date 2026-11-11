Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c py -3.11 confeccion_agente.py >> logs\confeccion-agent.log 2>&1", 0, False
