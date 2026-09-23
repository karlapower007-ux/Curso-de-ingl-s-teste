$ErrorActionPreference="SilentlyContinue"
$listeners=Get-NetTCPConnection -LocalPort 8788 -State Listen
foreach($l in @($listeners)){
  try{
    $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if($p.ProcessName -match "node"){ Stop-Process -Id $p.Id -Force }
  }catch{}
}
