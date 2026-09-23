param([switch]$NoBrowser)
$ErrorActionPreference="Stop"
$Root="C:\ConscienciaFabiano"
$Server=Join-Path $Root "scripts\v2-local-server.mjs"
if(-not (Test-Path $Server)){ throw "Consciência Fabiano não instalada em C:\ConscienciaFabiano." }

if(Get-Command ollama -ErrorAction SilentlyContinue){
  try{ Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null }
  catch{ Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden; Start-Sleep -Seconds 3 }
}

$listeners=Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
$healthy=$false
foreach($l in @($listeners)){
  try{
    $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if($p.ProcessName -match "node"){
      try{ $h=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/health" -TimeoutSec 2; if($h.ok){$healthy=$true} }catch{}
    }
  }catch{}
}
if(-not $healthy){
  foreach($l in @($listeners)){
    try{
      $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
      if($p.ProcessName -match "node"){ Stop-Process -Id $p.Id -Force }
    }catch{}
  }
  Start-Process -FilePath "node.exe" -ArgumentList @($Server) -WorkingDirectory $Root -WindowStyle Hidden
  for($i=0;$i -lt 45;$i++){
    try{ $h=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/health" -TimeoutSec 2; if($h.ok){$healthy=$true;break} }catch{}
    Start-Sleep -Seconds 1
  }
}
if(-not $healthy){ throw "Servidor local V4 não respondeu na porta 8788." }
if(-not $NoBrowser){ Start-Process "http://127.0.0.1:8788/?v4=1" }
