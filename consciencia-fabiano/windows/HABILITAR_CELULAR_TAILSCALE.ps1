$ErrorActionPreference="Stop"
Add-Type -AssemblyName System.Windows.Forms

try {
  $Root="C:\ConscienciaFabiano"
  if(-not (Test-Path $Root)){ throw "Instale primeiro a Consciência em C:\ConscienciaFabiano." }

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

  $ruleName="Consciencia Fabiano Mobile 8790"
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Profile Private -RemoteAddress LocalSubnet | Out-Null

  & (Join-Path $Root "windows\start-mobile-gateway.ps1")

  $lanIp=$null
  $configs=Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address -ne $null }
  foreach($cfg in @($configs)){
    $candidate=[string]$cfg.IPv4Address.IPAddress
    if($candidate -and $candidate -notmatch '^(127\.|169\.254\.)'){
      $lanIp=$candidate
      break
    }
  }
  $lanUrl=$null
  if($lanIp){ $lanUrl="http://" + $lanIp + ":8790/?token=" + $token }

  $tailscaleUrl=$null
  if(Get-Command tailscale -ErrorAction SilentlyContinue){
    try{
      $status=& tailscale status --json | ConvertFrom-Json
      if($status.Self){
        & tailscale serve --bg http://127.0.0.1:8790 | Out-Null
        $status=& tailscale status --json | ConvertFrom-Json
        $dns=([string]$status.Self.DNSName).TrimEnd(".")
        if($dns){ $tailscaleUrl="https://" + $dns + "/?token=" + $token }
      }
    }catch{}
  }

  $outLines=@()
  if($lanUrl){ $outLines += "MESMA WI-FI (pode funcionar sem internet): " + $lanUrl }
  if($tailscaleUrl){ $outLines += "TAILSCALE (fora da rede local): " + $tailscaleUrl }
  if(-not $outLines.Count){ throw "Não foi possível descobrir um endereço LAN nem Tailscale para este PC." }

  $payload=($outLines -join [Environment]::NewLine)
  Set-Content -Path $urlFile -Value $payload -Encoding utf8
  if($tailscaleUrl){ Set-Clipboard -Value $tailscaleUrl } else { Set-Clipboard -Value $lanUrl }

  $taskCmd='powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ConscienciaFabiano\windows\start-mobile-gateway.ps1"'
  schtasks.exe /Create /TN "ConscienciaFabianoMobile" /SC ONLOGON /TR $taskCmd /F | Out-Null

  $nl=[Environment]::NewLine
  $message="ACESSO DO CELULAR"+$nl+$nl+$payload+$nl+$nl+
    "O PC precisa permanecer ligado. A porta 8788 continua somente local; o celular entra pelo gateway autenticado 8790."+$nl+
    "O endereço preferido já foi copiado."
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
