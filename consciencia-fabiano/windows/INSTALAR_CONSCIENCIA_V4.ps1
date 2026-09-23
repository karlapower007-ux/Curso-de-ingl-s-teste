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

if(-not $SkipTask){
  $taskCmd='wscript.exe "C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs" /silent'
  schtasks.exe /Create /TN "ConscienciaFabianoV4" /SC ONLOGON /TR $taskCmd /F | Out-Null
}

Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList '"C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs"'
