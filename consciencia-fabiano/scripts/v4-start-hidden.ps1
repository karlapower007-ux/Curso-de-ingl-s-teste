param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$Root = "C:\ConscienciaFabiano"
$LogDir = Join-Path $Root ".fns-local"
$Log = Join-Path $LogDir "v4-start.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log($msg) {
  Add-Content -Path $Log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

if (-not (Test-Path (Join-Path $Root "scripts\v2-local-server.mjs"))) {
  throw "Instalacao canonica ausente em C:\ConscienciaFabiano."
}

# Ollama fica independente da Consciência; iniciamos somente se ele não estiver respondendo.
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
} catch {
  $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($ollama) {
    Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WindowStyle Hidden
    for ($i=0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 500
      try {
        Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
        break
      } catch {}
    }
  }
}

# Mata somente Node que esteja ocupando a porta local da Consciência.
$listeners = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
foreach ($l in @($listeners)) {
  try {
    $p = Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if ($p.ProcessName -match "^node") {
      Stop-Process -Id $p.Id -Force
      Log "Servidor Node antigo encerrado: PID $($p.Id)"
    }
  } catch {}
}

$node = Get-Command node.exe -ErrorAction Stop
$server = Join-Path $Root "scripts\v2-local-server.mjs"
$p = Start-Process -FilePath $node.Source -ArgumentList ('"' + $server + '"') -WorkingDirectory $Root -WindowStyle Hidden -PassThru
Log "Servidor V4 iniciado oculto: PID $($p.Id)"

$ok = $false
for ($i=0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/health" -TimeoutSec 2
    if ($h.ok) { $ok = $true; break }
  } catch {}
}
if (-not $ok) { throw "A V4 nao respondeu em http://127.0.0.1:8788/api/v4/health." }

Log "V4 pronta. Dicionario congelado: $($h.dictionary_frozen). Hash: $($h.library_hash)"

if (-not $NoBrowser) {
  Start-Process "https://consciencia-fabiano.focoeepoder2.workers.dev/?v4=1"
}
