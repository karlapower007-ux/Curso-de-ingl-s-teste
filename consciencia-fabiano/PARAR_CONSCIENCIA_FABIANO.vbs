Option Explicit
Dim shell, ps
Set shell = CreateObject("WScript.Shell")
ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\ConscienciaFabiano\scripts\v4-stop.ps1"""
shell.Run ps, 0, True
