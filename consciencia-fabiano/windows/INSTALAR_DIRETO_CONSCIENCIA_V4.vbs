Option Explicit
Dim app, fso, folder, ps, args
Set app=CreateObject("Shell.Application")
Set fso=CreateObject("Scripting.FileSystemObject")
folder=fso.GetParentFolderName(WScript.ScriptFullName)
ps=folder & "\INSTALAR_DIRETO_CONSCIENCIA_V4.ps1"
args="-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps & Chr(34)
app.ShellExecute "powershell.exe", args, folder, "runas", 0
