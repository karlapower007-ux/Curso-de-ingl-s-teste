Option Explicit
Dim sh, ps, noBrowser
Set sh=CreateObject("WScript.Shell")
ps="C:\ConscienciaFabiano\windows\start-hidden.ps1"
noBrowser=""
If WScript.Arguments.Named.Exists("silent") Then noBrowser=" -NoBrowser"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps & Chr(34) & noBrowser, 0, False
