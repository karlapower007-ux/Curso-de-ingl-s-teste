Option Explicit
Dim app, ps, args
Set app=CreateObject("Shell.Application")
ps="C:\ConscienciaFabiano\windows\HABILITAR_CELULAR_TAILSCALE.ps1"
args="-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps & Chr(34)
app.ShellExecute "powershell.exe", args, "", "runas", 0
