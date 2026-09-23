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
Get-NetFirewallRule -DisplayName "Consciencia Fabiano Mobile 8790" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Write-Host "Acesso móvel LAN/Tailscale da Consciência Fabiano desabilitado." -ForegroundColor Green
