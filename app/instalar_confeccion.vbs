Set sh = CreateObject("Shell.Application")
base = "C:\IndoorAgentes\Confeccion\instalar_confeccion.bat"
sh.ShellExecute "cmd.exe", "/c """ & base & """", "", "runas", 0
