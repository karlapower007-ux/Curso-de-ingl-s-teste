$ErrorActionPreference="SilentlyContinue"
$Root="C:\ConscienciaFabiano"
& tailscale serve reset | Out-Null
$listeners=Get-NetTCPConnection -LocalPort 8790 -State Listen
foreach($l in @($listeners)){
  try{
    $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if($p.ProcessName -match "node"){Stop-Process -Id $p.Id -Force}
  }catch{}
}
Remove-Item (Join-Path $Root ".fns-local\mobile-token.txt") -Force
Remove-Item (Join-Path $Root ".fns-local\mobile-url.txt") -Force
schtasks.exe /Delete /TN "ConscienciaFabianoMobile" /F | Out-Null
Write-Host "Acesso móvel Tailscale da Consciência Fabiano desabilitado." -ForegroundColor Green
