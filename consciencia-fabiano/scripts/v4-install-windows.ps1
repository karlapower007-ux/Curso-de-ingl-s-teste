param([string]$SourceRoot = "")

$ErrorActionPreference = "Stop"
$Target = "C:\ConscienciaFabiano"
if (-not $SourceRoot) { $SourceRoot = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path (Join-Path $SourceRoot "scripts\v2-local-server.mjs"))) {
  throw "Pasta de origem da Consciência Fabiano não encontrada."
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null

# Copia a aplicação sem tocar no banco local já existente no destino.
# biblioteca_backup é copiada, nunca apagada/reindexada por este instalador.
$excludeDirs = @("node_modules",".git",".fns-local",".wrangler-dry-run")
$args = @($SourceRoot,$Target,"/E","/R:1","/W:1","/NFL","/NDL","/NJH","/NJS","/NP")
foreach ($d in $excludeDirs) { $args += @("/XD",(Join-Path $SourceRoot $d)) }
& robocopy @args | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar a aplicação para C:\ConscienciaFabiano." }

$startScript = Join-Path $Target "scripts\v4-start-hidden.ps1"
$taskName = "Consciencia Fabiano V4"
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$startScript+'" -NoBrowser')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

# Atalhos na Área de Trabalho.
$desktop = [Environment]::GetFolderPath("Desktop")
$wsh = New-Object -ComObject WScript.Shell

$startLink = $wsh.CreateShortcut((Join-Path $desktop "Consciência Fabiano - Iniciar.lnk"))
$startLink.TargetPath = "wscript.exe"
$startLink.Arguments = '"' + (Join-Path $Target "INICIAR_CONSCIENCIA_FABIANO.vbs") + '"'
$startLink.WorkingDirectory = $Target
$startLink.Save()

$stopLink = $wsh.CreateShortcut((Join-Path $desktop "Consciência Fabiano - Parar.lnk"))
$stopLink.TargetPath = "wscript.exe"
$stopLink.Arguments = '"' + (Join-Path $Target "PARAR_CONSCIENCIA_FABIANO.vbs") + '"'
$stopLink.WorkingDirectory = $Target
$stopLink.Save()

# Redator externo sempre nasce desligado.
[Environment]::SetEnvironmentVariable("FNS_EXTERNAL_WRITER_ENABLED","0","User")

Write-Output "INSTALLED=C:\ConscienciaFabiano"
Write-Output "LOGON_TASK=$taskName"
Write-Output "EXTERNAL_WRITER=OFF"
