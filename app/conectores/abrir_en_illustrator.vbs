' Lanzador del protocolo indoor-ai: (boton "Abrir en Illustrator" del panel). Sin ventana.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
uri = Replace(WScript.Arguments(0), Chr(34), "")
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & carpeta & "\abrir_en_illustrator.ps1" & Chr(34) & " " & Chr(34) & uri & Chr(34), 0, False
