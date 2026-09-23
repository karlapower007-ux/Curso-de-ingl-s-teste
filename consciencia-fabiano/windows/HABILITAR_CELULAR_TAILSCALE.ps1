$ErrorActionPreference="Stop"
$Root="C:\ConscienciaFabiano"
if(-not (Test-Path $Root)){ throw "Instale primeiro a Consciência em C:\ConscienciaFabiano." }
if(-not (Get-Command tailscale -ErrorAction SilentlyContinue)){ throw "Tailscale não está instalado neste PC." }

$dir=Join-Path $Root ".fns-local"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$token=([guid]::NewGuid().ToString("N")+[guid]::NewGuid().ToString("N"))
Set-Content -Path (Join-Path $dir "mobile-token.txt") -Value $token -NoNewline -Encoding ascii

& (Join-Path $Root "windows\start-mobile-gateway.ps1")

# Publica somente o gateway autenticado 8790 dentro do tailnet.
# A porta 8788 permanece loopback e nunca é exposta.
& tailscale serve --bg http://127.0.0.1:8790 | Out-Null

$status=& tailscale status --json | ConvertFrom-Json
$dns=([string]$status.Self.DNSName).TrimEnd(".")
if(-not $dns){ throw "Não foi possível descobrir o endereço Tailscale deste PC." }
$url="https://$dns/?token=$token"
Set-Content -Path (Join-Path $dir "mobile-url.txt") -Value $url -Encoding utf8

$taskCmd='powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ConscienciaFabiano\windows\start-mobile-gateway.ps1"'
schtasks.exe /Create /TN "ConscienciaFabianoMobile" /SC ONLOGON /TR $taskCmd /F | Out-Null

Write-Host ""
Write-Host "CELULAR HABILITADO COM TAILSCALE + TOKEN" -ForegroundColor Green
Write-Host "A porta 8788 continua somente local." -ForegroundColor Green
Write-Host ""
Write-Host $url -ForegroundColor Cyan
Write-Host ""
Write-Host "Abra esse endereço no celular conectado ao mesmo tailnet Tailscale." -ForegroundColor Yellow
