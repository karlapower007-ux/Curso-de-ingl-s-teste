$ErrorActionPreference = "Stop"

function Assert($condition, $message) {
  if (-not $condition) { throw $message }
}

Write-Host "=== Homologação real Ollama / Windows ===" -ForegroundColor Cyan

$tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10
$modelNames = @($tags.models | ForEach-Object { $_.name })
Assert ($modelNames -contains "qwen3:0.6b") "qwen3:0.6b não está instalado."
Assert ($modelNames -contains "qwen3-embedding:0.6b") "qwen3-embedding:0.6b não está instalado."

$health = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/health" -TimeoutSec 20
Assert ($health.ok -eq $true) "Health v2 não respondeu OK."
Assert ($health.local_only -eq $true) "Servidor não está em modo local-only."
Assert ($health.version -eq "2.0.0-local-first") "Versão local incorreta."
Assert ($health.ollama.reachable -eq $true) "Servidor v2 não detectou o Ollama."
Assert ($health.embeddings.installed -eq $true) "Servidor v2 não detectou o embedding Qwen."

$embedBody = @{
  texts = @(
    "Plano de Salvação e Vida Pré-Mortal",
    "Joseph Smith relatou uma experiência religiosa."
  )
  persist = $false
} | ConvertTo-Json -Depth 8
$embed = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/embed" -Method Post -ContentType "application/json" -Body $embedBody -TimeoutSec 120
Assert ($embed.ok -eq $true) "Endpoint de embedding não respondeu OK."
Assert ($embed.model -eq "qwen3-embedding:0.6b") "Modelo de embedding incorreto."
Assert ([int]$embed.dimensions -gt 0) "Embedding real veio sem dimensões."
Assert (@($embed.vectors).Count -eq 2) "Quantidade de vetores diferente da solicitada."
Assert (@($embed.vectors[0]).Count -eq [int]$embed.dimensions) "Dimensão do vetor inconsistente."

$chatBody = @{
  question = "Segundo a evidência, qual é a relação entre Plano de Salvação e Vida Pré-Mortal?"
  mode = "explain"
  model = "qwen3:0.6b"
  semantic = $false
  evidence = @(
    @{
      id = "homolog:1"
      document_id = "homologacao"
      title = "Livro de Homologação"
      page = 10
      chunk_index = 1
      text = "O Plano de Salvação inclui ensinamentos sobre a Vida Pré-Mortal e a experiência mortal."
      reference = "Livro de Homologação • página 10"
    }
  )
} | ConvertTo-Json -Depth 12

$chat = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/chat" -Method Post -ContentType "application/json" -Body $chatBody -TimeoutSec 300
Assert ($chat.ok -eq $true) "Chat local não respondeu OK."
Assert ($chat.provider -eq "ollama-local") "Chat não usou Ollama local."
Assert ($chat.model -eq "qwen3:0.6b") "Chat não usou o modelo homologado."
Assert ([string]::IsNullOrWhiteSpace([string]$chat.answer) -eq $false) "Resposta real do Qwen veio vazia."
Assert (@($chat.matches).Count -gt 0) "Chat não devolveu a evidência usada."

$exactBody = @{
  question = "Plano de Salvação e Vida Pré-Mortal"
  mode = "exact"
  model = "modelo-inexistente-que-nao-deve-ser-usado"
  page_size = 10
  evidence = @(
    @{
      id = "homolog:exact"
      document_id = "homologacao"
      title = "Livro de Homologação"
      page = 11
      chunk_index = 2
      text = "O Plano de Salvação inclui a Vida Pré-Mortal."
      reference = "Livro de Homologação • página 11"
    }
  )
} | ConvertTo-Json -Depth 12

$exact = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/chat" -Method Post -ContentType "application/json" -Body $exactBody -TimeoutSec 30
Assert ($exact.ok -eq $true) "Citação exata não respondeu OK."
Assert ($exact.bypass_llm -eq $true) "Citação exata não confirmou bypass de LLM."
Assert ($exact.exact_retrieval -eq $true) "Citação exata não confirmou exact retrieval."
Assert ($exact.provider -eq "local-exact-no-llm") "Citação exata passou pelo provedor errado."
Assert ([string]$exact.answer -match "Plano de Salvação") "Citação exata não retornou o trecho literal."

$result = [ordered]@{
  ok = $true
  platform = "windows"
  ollama_real = $true
  brain_model = "qwen3:0.6b"
  embedding_model = "qwen3-embedding:0.6b"
  embedding_dimensions = [int]$embed.dimensions
  chat_provider = [string]$chat.provider
  chat_answer_nonempty = $true
  exact_zero_llm = $true
  version = [string]$health.version
}

$result | ConvertTo-Json -Depth 8
Write-Host "V2_WINDOWS_REAL_OLLAMA_HOMOLOGATION=pass" -ForegroundColor Green
