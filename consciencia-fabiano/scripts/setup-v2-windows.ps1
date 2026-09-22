$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

Write-Host "=== Consciência Fabiano v2 - instalação local ===" -ForegroundColor Cyan

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path","Machine")
  $user = [Environment]::GetEnvironmentVariable("Path","User")
  $env:Path = "$machine;$user"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Instalando Node.js LTS..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    Refresh-Path
  } else {
    throw "Node.js não encontrado e o winget não está disponível."
  }
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando Ollama pelo instalador oficial..." -ForegroundColor Yellow
  irm https://ollama.com/install.ps1 | iex
  Refresh-Path
}

$ramBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$ramGB = [math]::Round($ramBytes / 1GB)

if ($env:FNS_BRAIN_MODEL) {
  $brain = $env:FNS_BRAIN_MODEL
} elseif ($ramGB -ge 32) {
  $brain = "qwen3.8:27b"
} elseif ($ramGB -ge 16) {
  $brain = "qwen3:8b"
} elseif ($ramGB -ge 10) {
  $brain = "qwen3:4b"
} elseif ($ramGB -ge 6) {
  $brain = "qwen3:1.7b"
} else {
  $brain = "qwen3:0.6b"
}

Write-Host "RAM detectada: $ramGB GB" -ForegroundColor Green
Write-Host "Cérebro escolhido: $brain" -ForegroundColor Green
Write-Host "Embedding: qwen3-embedding:0.6b" -ForegroundColor Green

$ollamaReady = $false
for ($i=0; $i -lt 20; $i++) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
    $ollamaReady = $true
    break
  } catch {
    if ($i -eq 0) {
      try { Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden } catch {}
    }
    Start-Sleep -Seconds 1
  }
}
if (-not $ollamaReady) {
  throw "O Ollama não iniciou em http://127.0.0.1:11434."
}

Write-Host "Baixando/verificando o modelo de embeddings..." -ForegroundColor Yellow
ollama pull qwen3-embedding:0.6b
if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar qwen3-embedding:0.6b." }

Write-Host "Baixando/verificando o cérebro local..." -ForegroundColor Yellow
ollama pull $brain
if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $brain." }

if (-not (Test-Path "node_modules")) {
  Write-Host "Instalando dependências locais..." -ForegroundColor Yellow
  npm install --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "Falha no npm install." }
}

$existing = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Iniciando Consciência Fabiano v2..." -ForegroundColor Cyan
  Start-Process -FilePath "node" -ArgumentList "scripts/v2-local-server.mjs" -WorkingDirectory $project
}

$ready = $false
for ($i=0; $i -lt 30; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/health" -TimeoutSec 2
    if ($health.ok) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw "O servidor local não respondeu na porta 8788." }

Write-Host "Pronto. Consciência Fabiano v2 disponível em http://127.0.0.1:8788" -ForegroundColor Green
if ($env:CI -ne "true" -and $env:FNS_NO_OPEN -ne "1") {
  Start-Process "http://127.0.0.1:8788"
}
