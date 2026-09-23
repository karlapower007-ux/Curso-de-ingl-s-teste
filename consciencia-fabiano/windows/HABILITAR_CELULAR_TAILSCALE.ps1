$ErrorActionPreference="Stop"
Add-Type -AssemblyName System.Windows.Forms

try {
  $Root="C:\ConscienciaFabiano"
  if(-not (Test-Path $Root)){ throw "Instale primeiro a Consciência em C:\ConscienciaFabiano." }
  if(-not (Get-Command tailscale -ErrorAction SilentlyContinue)){ throw "Tailscale não está instalado neste PC." }

  $status=& tailscale status --json | ConvertFrom-Json
  if(-not $status.Self){ throw "Tailscale não está conectado. Entre na sua conta Tailscale neste PC e tente novamente." }

  $dir=Join-Path $Root ".fns-local"
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $tokenFile=Join-Path $dir "mobile-token.txt"
  $urlFile=Join-Path $dir "mobile-url.txt"

  if(Test-Path $tokenFile){
    $token=(Get-Content $tokenFile -Raw).Trim()
  }else{
    $token=([guid]::NewGuid().ToString("N")+[guid]::NewGuid().ToString("N"))
    Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
  }

  & (Join-Path $Root "windows\start-mobile-gateway.ps1")
  & tailscale serve --bg http://127.0.0.1:8790 | Out-Null

  $status=& tailscale status --json | ConvertFrom-Json
  $dns=([string]$status.Self.DNSName).TrimEnd(".")
  if(-not $dns){ throw "Não foi possível descobrir o endereço Tailscale deste PC." }

  $url="https://$dns/?token=$token"
  Set-Content -Path $urlFile -Value $url -Encoding utf8
  Set-Clipboard -Value $url

  $taskCmd='powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ConscienciaFabiano\windows\start-mobile-gateway.ps1"'
  schtasks.exe /Create /TN "ConscienciaFabianoMobile" /SC ONLOGON /TR $taskCmd /F | Out-Null

  $nl=[Environment]::NewLine
  $message="Endereço real do celular:"+$nl+$nl+$url+$nl+$nl+"O endereço já foi copiado. O celular precisa estar conectado ao mesmo Tailscale. O PC precisa permanecer ligado para usar Aula/Livro V3/V4 pelo celular."
  [System.Windows.Forms.MessageBox]::Show(
    $message,
    "Consciência Fabiano • Celular",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show(
    [string]$_.Exception.Message,
    "Consciência Fabiano • Celular",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  ) | Out-Null
  exit 1
}
