Option Explicit
Dim http, stream, app, tempPath, url, args

url = "https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/consciencia-cloudflare-native-v1/consciencia-fabiano/windows/INSTALAR_DIRETO_CONSCIENCIA_V4.ps1"
tempPath = CreateObject("WScript.Shell").ExpandEnvironmentStrings("%TEMP%") & "\ATUALIZAR_CONSCIENCIA_FABIANO_50K.ps1"

On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", url, False
http.Send
If Err.Number <> 0 Or http.Status <> 200 Then
  MsgBox "Nao foi possivel baixar a atualizacao. Verifique a Internet e tente novamente.", 16, "Consciencia Fabiano 50K"
  WScript.Quit 1
End If

Set stream = CreateObject("ADODB.Stream")
stream.Type = 1
stream.Open
stream.Write http.responseBody
stream.SaveToFile tempPath, 2
stream.Close
If Err.Number <> 0 Then
  MsgBox "Nao foi possivel preparar o atualizador.", 16, "Consciencia Fabiano 50K"
  WScript.Quit 1
End If
On Error GoTo 0

Set app = CreateObject("Shell.Application")
args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & tempPath & Chr(34)
app.ShellExecute "powershell.exe", args, "", "runas", 0
