Option Explicit
Dim sh, ps
Set sh=CreateObject("WScript.Shell")
ps="C:\ConscienciaFabiano\windows\stop-local.ps1"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps & Chr(34), 0, False
