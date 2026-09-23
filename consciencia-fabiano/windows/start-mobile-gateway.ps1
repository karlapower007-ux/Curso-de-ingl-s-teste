$ErrorActionPreference="Stop"
$Root="C:\ConscienciaFabiano"
$TokenFile=Join-Path $Root ".fns-local\mobile-token.txt"
$Gateway=Join-Path $Root "scripts\v4-mobile-gateway.mjs"
if(-not (Test-Path $TokenFile)){ exit 0 }
if(-not (Test-Path $Gateway)){ throw "Gateway móvel V4 não encontrado." }
$token=(Get-Content $TokenFile -Raw).Trim()
if(-not $token){ exit 0 }

$listeners=Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue
$running=$false
foreach($l in @($listeners)){
  try{
    $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if($p.ProcessName -match "node"){$running=$true}
  }catch{}
}
if(-not $running){
  $env:FNS_MOBILE_TOKEN=$token
  Start-Process -FilePath "node.exe" -ArgumentList @($Gateway) -WorkingDirectory $Root -WindowStyle Hidden
  for($i=0;$i -lt 20;$i++){
    if(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue){break}
    Start-Sleep -Milliseconds 500
  }
}
if(Get-Command tailscale -ErrorAction SilentlyContinue){
  & tailscale serve --bg http://127.0.0.1:8790 | Out-Null
}
