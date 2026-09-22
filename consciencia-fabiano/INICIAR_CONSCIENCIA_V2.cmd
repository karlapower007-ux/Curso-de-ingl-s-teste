@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-v2-windows.ps1"
if errorlevel 1 (
  echo.
  echo A instalacao encontrou um erro. Veja a mensagem acima.
  pause
)
endlocal
