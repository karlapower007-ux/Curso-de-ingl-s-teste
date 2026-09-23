Option Explicit
Dim shellApp, fso, here, scriptPath, args
Set shellApp = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = here & "\scripts\v4-install-windows.ps1"
args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """ -SourceRoot """ & here & """"
' runas mostra apenas o UAC quando necessário; não abre terminal visível.
shellApp.ShellExecute "powershell.exe", args, "", "runas", 0
