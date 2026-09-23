Option Explicit
Dim shellApp, fso, temp, ps1, cmd, url
Set shellApp = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")

temp = CreateObject("WScript.Shell").ExpandEnvironmentStrings("%TEMP%")
ps1 = temp & "\INSTALAR_DIRETO_CONSCIENCIA_V4.ps1"
url = "https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/consciencia-cloudflare-native-v1/consciencia-fabiano/windows/INSTALAR_DIRETO_CONSCIENCIA_V4.ps1"

cmd = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command " & Chr(34) & _
      "$ErrorActionPreference='Stop'; " & _
      "Invoke-WebRequest -UseBasicParsing -Uri '" & url & "' -OutFile '" & Replace(ps1,"'","''") & "'; " & _
      "& '" & Replace(ps1,"'","''") & "'" & Chr(34)

shellApp.ShellExecute "powershell.exe", cmd, "", "runas", 0
