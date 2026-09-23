param([switch]$SkipTask)
$ErrorActionPreference="Stop"
$Target="C:\ConscienciaFabiano"
$Source=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  Start-Process powershell.exe -Verb RunAs -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$MyInvocation.MyCommand.Path)
  exit
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
$exclude=@(".git",".github",".wrangler-dry-run",".fns-local","node_modules")
$xd=$exclude | ForEach-Object { "/XD"; Join-Path $Source $_ }
& robocopy $Source $Target /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP @xd | Out-Null
if($LASTEXITCODE -ge 8){ throw "Falha ao copiar o projeto para C:\ConscienciaFabiano." }

$ImportDir=Join-Path $Target "ImportarPDFs"
New-Item -ItemType Directory -Path $ImportDir -Force | Out-Null

Push-Location $Target
try{
  npm install --omit=dev --ignore-scripts --no-audit --no-fund | Out-Null
  if($LASTEXITCODE -ne 0){ throw "Falha ao instalar o leitor PDF local para a biblioteca massiva." }
}finally{ Pop-Location }

$desktop=[Environment]::GetFolderPath("Desktop")
$wsh=New-Object -ComObject WScript.Shell
$start=$wsh.CreateShortcut((Join-Path $desktop "Iniciar Consciência Fabiano.lnk"))
$start.TargetPath="$env:WINDIR\System32\wscript.exe"
$start.Arguments='"C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs"'
$start.WorkingDirectory=$Target
$start.Save()

$stop=$wsh.CreateShortcut((Join-Path $desktop "Parar Consciência Fabiano.lnk"))
$stop.TargetPath="$env:WINDIR\System32\wscript.exe"
$stop.Arguments='"C:\ConscienciaFabiano\windows\PARAR_CONSCIENCIA_V4.vbs"'
$stop.WorkingDirectory=$Target
$stop.Save()

$mobile=$wsh.CreateShortcut((Join-Path $desktop "Consciência Fabiano - Celular.lnk"))
$mobile.TargetPath="$env:WINDIR\System32\wscript.exe"
$mobile.Arguments='"C:\ConscienciaFabiano\windows\CELULAR_CONSCIENCIA_V4.vbs"'
$mobile.WorkingDirectory=$Target
$mobile.Save()

$import=$wsh.CreateShortcut((Join-Path $desktop "Adicionar PDFs - Consciência Fabiano.lnk"))
$import.TargetPath="$env:WINDIR\explorer.exe"
$import.Arguments='"C:\ConscienciaFabiano\ImportarPDFs"'
$import.WorkingDirectory=$ImportDir
$import.Save()

$readme=@"
IMPORTAÇÃO MASSIVA — CONSCIÊNCIA FABIANO

Coloque PDFs nesta pasta. Pode usar subpastas.
O sistema processa automaticamente um arquivo por vez.
Arquivos já indexados não são duplicados quando o SHA-256 é igual.
PDFs sem texto selecionável ficam marcados como needs_ocr e não contaminam a busca.
A biblioteca antiga permanece congelada.
"@
Set-Content -Path (Join-Path $ImportDir "COMO_ADICIONAR_PDFS.txt") -Value $readme -Encoding UTF8

if(-not $SkipTask){
  $taskCmd='wscript.exe "C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs" /silent'
  schtasks.exe /Create /TN "ConscienciaFabianoV4" /SC ONLOGON /TR $taskCmd /F | Out-Null
}

Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList '"C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs"'
