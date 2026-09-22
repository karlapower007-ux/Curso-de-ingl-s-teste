$ErrorActionPreference = "Stop"

Write-Host "=== REINICIAR CEREBRO LOCAL - CONSCIENCIA FABIANO V2 ===" -ForegroundColor Cyan

function Find-Project {
  $candidates = @()
  if ($env:FNS_PROJECT_DIR) { $candidates += $env:FNS_PROJECT_DIR }
  $candidates += @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop"),
    (Get-Location).Path
  )

  foreach ($root in $candidates) {
    if (-not (Test-Path $root)) { continue }
    if (Test-Path (Join-Path $root "INICIAR_CONSCIENCIA_V2.cmd")) {
      return (Resolve-Path $root).Path
    }
    $found = Get-ChildItem -Path $root -Filter "INICIAR_CONSCIENCIA_V2.cmd" -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Directory.Name -eq "consciencia-fabiano" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($found) { return $found.Directory.FullName }
  }
  throw "Nao encontrei a pasta consciencia-fabiano. Se necessario, mova o arquivo REINICIAR para dentro dela."
}

function Ensure-Ollama {
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Ollama nao encontrado. Execute primeiro INICIAR_CONSCIENCIA_V2.cmd."
  }
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
  } catch {
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
}

function Ensure-Model($name) {
  $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10
  $names = @($tags.models | ForEach-Object { $_.name })
  if ($names -notcontains $name) {
    Write-Host "Baixando $name..." -ForegroundColor Yellow
    & ollama pull $name
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $name." }
  }
}

$project = Find-Project
Write-Host "Pasta encontrada: $project" -ForegroundColor Green

$base = "https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/consciencia-cloudflare-native-v1/consciencia-fabiano/"
$files = @(
  "scripts/v2-local-server.mjs",
  "scripts/v2-local-core.mjs",
  "scripts/v3-evidence-core.mjs",
  "public/v2-local-ui.js",
  "public/v2-local-engine.js",
  "public/v2-aliases.json",
  "public/whisper-local.js",
  "public/index.html",
  "public/style.css"
)

foreach ($rel in $files) {
  $dest = Join-Path $project ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
  New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
  Write-Host "Atualizando $rel..." -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri ($base + $rel) -OutFile $dest
}

Ensure-Ollama
Ensure-Model "qwen3:0.6b"
Ensure-Model "qwen3-embedding:0.6b"

$listeners = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
foreach ($l in @($listeners)) {
  try {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction Stop
    if ($proc.ProcessName -match "node") {
      Write-Host "Encerrando servidor antigo PID $($proc.Id)..." -ForegroundColor Yellow
      Stop-Process -Id $proc.Id -Force
    }
  } catch {}
}
Start-Sleep -Milliseconds 800

$server = Join-Path $project "scripts\v2-local-server.mjs"
Write-Host "Iniciando servidor local atualizado..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k","cd /d `"$project`" && node `"$server`"" -WorkingDirectory $project

$health = $null
for ($i=0; $i -lt 40; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/health" -TimeoutSec 2
    if ($health.ok) { break }
  } catch {}
  Start-Sleep -Seconds 1
}

if (-not $health -or -not $health.ok) { throw "O servidor local nao respondeu na porta 8788." }

$installed = @($health.ollama.installed)
if ($installed -notcontains "qwen3:0.6b") { throw "O servidor nao confirmou qwen3:0.6b." }
if (-not $health.embeddings.installed) { throw "O servidor nao confirmou qwen3-embedding:0.6b." }

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "CEREBRO LOCAL PRONTO" -ForegroundColor Green
Write-Host "Modelo: $($health.hardware.selected)" -ForegroundColor Green
Write-Host "Embedding: $($health.embeddings.model)" -ForegroundColor Green
Write-Host "Chunks: $($health.library.chunks)" -ForegroundColor Green
Write-Host "Build: $($health.local_runtime_build)" -ForegroundColor Green
try {
  $v3 = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v3/health" -TimeoutSec 30
  Write-Host "Evidence V3: $($v3.evidence_units) unidades • Dicionario congelado: $($v3.dictionary_frozen)" -ForegroundColor Green
} catch {
  Write-Host "Evidence V3 ainda preparando; o servidor continuara carregando em paralelo." -ForegroundColor Yellow
}
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

Start-Process "https://consciencia-fabiano.focoeepoder2.workers.dev/?local_restart=2"
