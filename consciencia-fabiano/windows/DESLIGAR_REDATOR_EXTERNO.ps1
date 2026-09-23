$ErrorActionPreference="Stop"
[Environment]::SetEnvironmentVariable("FNS_EXTERNAL_WRITER_ENABLED","0","User")
[Environment]::SetEnvironmentVariable("FNS_EXTERNAL_WRITER_URL",$null,"User")
[Environment]::SetEnvironmentVariable("FNS_EXTERNAL_WRITER_TOKEN",$null,"User")

$Root="C:\ConscienciaFabiano"
$listeners=Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
foreach($l in @($listeners)){
  try{
    $p=Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if($p.ProcessName -match "node"){Stop-Process -Id $p.Id -Force}
  }catch{}
}
Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList '"C:\ConscienciaFabiano\windows\INICIAR_CONSCIENCIA_V4.vbs"'
Write-Host "Redator externo DESLIGADO. A Aula V4 voltou ao caminho local." -ForegroundColor Green
