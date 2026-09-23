$ErrorActionPreference="Stop"
Add-Type -AssemblyName System.Windows.Forms

function Show-Info($text){
  [System.Windows.Forms.MessageBox]::Show(
    [string]$text,
    "Consciência Fabiano V4",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}
function Show-Error($text){
  [System.Windows.Forms.MessageBox]::Show(
    [string]$text,
    "Consciência Fabiano V4",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

try {
  $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
      "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",$MyInvocation.MyCommand.Path
    )
    exit
  }

  if(-not (Get-Command node.exe -ErrorAction SilentlyContinue)){
    throw "Node.js não foi encontrado. Este PC precisa manter o Node.js já usado pela Consciência Fabiano."
  }
  if(-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)){
    throw "Ollama não foi encontrado. Instale/recupere o Ollama antes de concluir a V4."
  }

  $tags=Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 -ErrorAction SilentlyContinue
  if(-not $tags){
    Start-Process "ollama.exe" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $tags=Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 6
  }
  $names=@($tags.models | ForEach-Object { $_.name })
  if($names -notcontains "qwen3:0.6b"){ & ollama pull "qwen3:0.6b"; if($LASTEXITCODE -ne 0){throw "Falha ao preparar qwen3:0.6b."} }
  if($names -notcontains "qwen3-embedding:0.6b"){ & ollama pull "qwen3-embedding:0.6b"; if($LASTEXITCODE -ne 0){throw "Falha ao preparar qwen3-embedding:0.6b."} }

  $temp=Join-Path $env:TEMP ("ConscienciaFabianoV4-"+[guid]::NewGuid().ToString("N"))
  $zip=Join-Path $temp "branch.zip"
  New-Item -ItemType Directory -Path $temp -Force | Out-Null

  $repoApi="https://api.github.com/repos/karlapower007-ux/Curso-de-ingl-s-teste/branches/consciencia-cloudflare-native-v1"
  $headers=@{"User-Agent"="Consciencia-Fabiano-Updater";"Cache-Control"="no-cache";"Pragma"="no-cache"}
  $branchInfo=Invoke-RestMethod -Uri ($repoApi+"?nocache="+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Headers $headers -TimeoutSec 30
  $branchSha=[string]$branchInfo.commit.sha
  if($branchSha -notmatch '^[0-9a-f]{40}

  $installer=Get-ChildItem -Path $temp -Filter "INSTALAR_CONSCIENCIA_V4.ps1" -File -Recurse |
    Where-Object { $_.Directory.Name -eq "windows" } |
    Select-Object -First 1
  if(-not $installer){ throw "O instalador canônico da V4 não foi encontrado no pacote baixado." }

  & $installer.FullName
  if($LASTEXITCODE -and $LASTEXITCODE -ne 0){ throw "O instalador canônico retornou erro $LASTEXITCODE." }

  $v2=$null;$v3=$null;$v4=$null
  for($i=0;$i -lt 90;$i++){
    try{
      $v2=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/health" -TimeoutSec 3
      $v3=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v3/health" -TimeoutSec 8
      $v4=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/health" -TimeoutSec 8
      if($v2.ok -and $v3.ok -and $v4.ok){break}
    }catch{}
    Start-Sleep -Seconds 1
  }
  if(-not ($v2.ok -and $v3.ok -and $v4.ok)){ throw "A instalação terminou, mas V2/V3/V4 não responderam corretamente na porta local 8788." }
  if(([string]$v4.version) -ne "4.1.1-lesson-grounded-fallback"){ throw "A versão V4.1.1 corrigida não entrou em memória. Detectado: "+[string]$v4.version }
  if(([string]$v2.local_runtime_build) -ne "2026-09-23-v4.1.1-repair-cache"){ throw "O servidor local ainda não está no build de reparo V4.1.1. Detectado: "+[string]$v2.local_runtime_build }
  if(-not $v4.dictionary_frozen){ throw "A V4 não confirmou o Dicionário congelado. Instalação interrompida." }
  if(-not $v2.source_link.enabled){ throw "A Fonte Viva não foi confirmada no servidor local." }
  if(-not $v2.source_link.dictionary){ throw "A Fonte Viva não foi confirmada no Dicionário." }
  if(-not $v2.source_link.chat){ throw "A Fonte Viva não foi confirmada no Chat." }
  if(-not $v2.source_link.lesson){ throw "A Fonte Viva não foi confirmada na Aula." }
  if($v2.source_link.original_upload_endpoint -ne "/api/v3/source/original"){ throw "Endpoint de preservação do PDF original não confirmado." }
  if($v2.source_link.pdf_view_endpoint -ne "/api/v3/source/pdf"){ throw "Endpoint de leitura do PDF original não confirmado." }
  if(-not $v2.source_link.range_requests){ throw "Leitura parcial Range do PDF não foi confirmada." }

  $library50k=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v3/library/status" -TimeoutSec 30
  if(-not $library50k.ok){ throw "A biblioteca incremental 50K não respondeu." }
  if(-not $library50k.base_frozen){ throw "A biblioteca-base não foi confirmada como congelada." }
  if(-not $library50k.append_only){ throw "A camada incremental não foi confirmada como append-only." }
  if(([string]$library50k.incremental.version) -notmatch '50k'){ throw "A arquitetura incremental 50K não foi confirmada." }
  if(-not (Test-Path "C:\ConscienciaFabiano\ImportarPDFs")){ throw "A pasta ImportarPDFs não foi criada." }
  if(-not (Test-Path "C:\ConscienciaFabiano\node_modules\pdfjs-dist")){ throw "O leitor PDF local pdfjs-dist não foi instalado." }
  if($v4.lesson_endpoint -ne "/api/v4/lesson"){ throw "Endpoint da Aula V4 não confirmado." }

  $dict=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/dictionary" -Method Post -ContentType "application/json" -Body '{"query":"Adão","page":1,"page_size":3}' -TimeoutSec 30
  if(-not $dict.ok){ throw "O Dicionário V2 não respondeu após a instalação." }

  # Validação REAL no dispositivo: usa o Qwen local instalado neste Windows.
  $lessonBody=@{
    question="O que é o mundo espiritual?"
    age=12
    mode="aula"
  } | ConvertTo-Json -Compress
  $lesson=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/lesson" -Method Post -ContentType "application/json" -Body $lessonBody -TimeoutSec 300
  if(-not $lesson.ok){ throw "A rota de Aula V4 não respondeu corretamente no teste real." }
  if($lesson.nao_sei){ throw "A V4 foi instalada, mas o Qwen local não conseguiu formar a aula real de validação com duas provas. A instalação não será marcada como validada." }
  if(@($lesson.provas).Count -lt 2){ throw "A aula real retornou menos de duas provas." }
  foreach($proof in @($lesson.provas)){
    if(-not $proof.verified){ throw "A aula real retornou uma prova sem selo verified." }
    if([string]::IsNullOrWhiteSpace([string]$proof.trecho_original)){ throw "A aula real retornou prova sem trecho original." }
    if([string]::IsNullOrWhiteSpace([string]$proof.ref)){ throw "A aula real retornou prova sem referência." }
  }
  if([string]::IsNullOrWhiteSpace([string]$lesson.ideia)){ throw "A aula real retornou ideia vazia." }
  if(([string]$lesson.ideia) -match '^\s*\d'){ throw "A ideia real começou por número de página; validação recusada." }
  if((([string]$lesson.verificacao) -ne "support_quote_literal+entailment_local") -and (([string]$lesson.verificacao) -ne "support_quote_literal+exact-copy-lock")){
    throw "A verificação final da Aula não foi confirmada no teste real."
  }

  # Regressão crítica: a biblioteca já contém centenas de ocorrências de expiação.
  # A instalação só é aceita se a pergunta natural que falhou no dispositivo responder.
  $atonementBody=@{
    question="O que é a expiação?"
    age=12
    mode="aula"
  } | ConvertTo-Json -Compress
  $atonement=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/lesson" -Method Post -ContentType "application/json" -Body $atonementBody -TimeoutSec 300
  if(-not $atonement.ok){ throw "Teste de regressão da Expiação não respondeu." }
  if($atonement.nao_sei){ throw "REGRESSÃO: a Aula ainda respondeu 'Não achei na biblioteca' para 'O que é a expiação?'." }
  if(@($atonement.provas).Count -lt 2){ throw "REGRESSÃO: a resposta sobre Expiação retornou menos de duas provas." }
  foreach($proof in @($atonement.provas)){
    if(-not $proof.verified){ throw "REGRESSÃO: a resposta sobre Expiação trouxe prova sem selo verified." }
    if([string]::IsNullOrWhiteSpace([string]$proof.ref)){ throw "REGRESSÃO: a resposta sobre Expiação trouxe prova sem referência." }
  }

  # Teste técnico da voz: Piper, quando disponível, deve produzir WAV. Caso contrário,
  # o navegador continua sendo o fallback, cuja audição depende do dispositivo do usuário.
  $voiceStatus="browser-fallback-pending-user-audio"
  if($v4.tts.ready){
    $wav=Join-Path $env:TEMP ("fns-v4-voice-"+[guid]::NewGuid().ToString("N")+".wav")
    $ttsBody=@{
      ideia=[string]$lesson.ideia
      explicacao=@($lesson.explicacao)
    } | ConvertTo-Json -Compress
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8788/api/v4/tts" -Method Post -ContentType "application/json" -Body $ttsBody -OutFile $wav -TimeoutSec 120
    $wavSize=(Get-Item $wav).Length
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    if($wavSize -le 44){ throw "Piper respondeu, mas o WAV de teste ficou inválido." }
    $voiceStatus="piper-wav-generated"
  }

  $validationDir="C:\ConscienciaFabiano\.fns-local"
  New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
  $validation=[ordered]@{
    validated_at=(Get-Date).ToString("o")
    installed_from_commit=$branchSha
    local_url="http://127.0.0.1:8788"
    v2_version=$v2.version
    v3_version=$v3.version
    v3_evidence_units=$v3.evidence_units
    architecture_50k=$library50k.incremental.version
    incremental_documents=$library50k.incremental.documents
    incremental_blocks=$library50k.incremental.blocks
    mass_import_dir=$library50k.mass_import.import_dir
    base_frozen=$library50k.base_frozen
    append_only=$library50k.append_only
    v4_version=$v4.version
    library_hash=$v4.library_hash
    dictionary_frozen=$v4.dictionary_frozen
    dictionary_query="Adão"
    dictionary_total=$dict.total
    fonte_viva_enabled=$v2.source_link.enabled
    fonte_viva_dictionary=$v2.source_link.dictionary
    fonte_viva_chat=$v2.source_link.chat
    fonte_viva_lesson=$v2.source_link.lesson
    fonte_viva_pdf_view=$v2.source_link.pdf_view_endpoint
    fonte_viva_exact_page=$v2.source_link.exact_pdf_page_fragment
    qwen_model=$lesson.modelo
    semantic_verification=$lesson.verificacao
    lesson_nao_sei=$lesson.nao_sei
    lesson_idea=$lesson.ideia
    atonement_question="O que é a expiação?"
    atonement_nao_sei=$atonement.nao_sei
    atonement_model=$atonement.modelo
    atonement_verification=$atonement.verificacao
    atonement_proofs=@($atonement.provas).Count
    lesson_proofs=@($lesson.provas | ForEach-Object {
      [ordered]@{
        ref=$_.ref
        verified=$_.verified
        idioma_original=$_.idioma_original
        pagina_pdf=$_.pagina_pdf
        pagina_impressa=$_.pagina_impressa
        pagina_tipo=$_.pagina_tipo
      }
    })
    voice_technical_status=$voiceStatus
    mobile_status="pending-user-tailscale-device"
  }
  $validation | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $validationDir "install-validation.json") -Encoding UTF8

  $message="INSTALAÇÃO VALIDADA"+[Environment]::NewLine+[Environment]::NewLine+
    "Local: http://127.0.0.1:8788"+[Environment]::NewLine+
    "Commit instalado: "+$branchSha+[Environment]::NewLine+
    "V4: "+$v4.version+[Environment]::NewLine+
    "Aula real Qwen: validada com "+@($lesson.provas).Count+" provas"+[Environment]::NewLine+
    "Expiação: RESPONDEU com "+@($atonement.provas).Count+" provas • falso 'não achei' bloqueado"+[Environment]::NewLine+
    "V3 unidades: "+$v3.evidence_units+[Environment]::NewLine+
    "Biblioteca 50K: "+$library50k.incremental.version+[Environment]::NewLine+
    "Pasta massiva: C:\ConscienciaFabiano\ImportarPDFs"+[Environment]::NewLine+
    "Dicionário V2: preservado ("+$dict.total+" ocorrências para Adão)"+[Environment]::NewLine+
    "Fonte Viva: Dicionário + Chat + Aula • PDF original na página citada"+[Environment]::NewLine+
    "Voz técnica: "+$voiceStatus+[Environment]::NewLine+
    "Relatório: C:\ConscienciaFabiano\.fns-local\install-validation.json"+[Environment]::NewLine+
    "Biblioteca hash: "+$v4.library_hash
  Show-Info $message

  Start-Process "http://127.0.0.1:8788/__repair"
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Show-Error $_.Exception.Message
  exit 1
}
){ throw "Não foi possível confirmar o commit atual da atualização." }
  $url="https://github.com/karlapower007-ux/Curso-de-ingl-s-teste/archive/"+$branchSha+".zip"
  Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $temp -Force

  $installer=Get-ChildItem -Path $temp -Filter "INSTALAR_CONSCIENCIA_V4.ps1" -File -Recurse |
    Where-Object { $_.Directory.Name -eq "windows" } |
    Select-Object -First 1
  if(-not $installer){ throw "O instalador canônico da V4 não foi encontrado no pacote baixado." }

  & $installer.FullName
  if($LASTEXITCODE -and $LASTEXITCODE -ne 0){ throw "O instalador canônico retornou erro $LASTEXITCODE." }

  $v2=$null;$v3=$null;$v4=$null
  for($i=0;$i -lt 90;$i++){
    try{
      $v2=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/health" -TimeoutSec 3
      $v3=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v3/health" -TimeoutSec 8
      $v4=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/health" -TimeoutSec 8
      if($v2.ok -and $v3.ok -and $v4.ok){break}
    }catch{}
    Start-Sleep -Seconds 1
  }
  if(-not ($v2.ok -and $v3.ok -and $v4.ok)){ throw "A instalação terminou, mas V2/V3/V4 não responderam corretamente na porta local 8788." }
  if(-not $v4.dictionary_frozen){ throw "A V4 não confirmou o Dicionário congelado. Instalação interrompida." }
  if(-not $v2.source_link.enabled){ throw "A Fonte Viva não foi confirmada no servidor local." }
  if(-not $v2.source_link.dictionary){ throw "A Fonte Viva não foi confirmada no Dicionário." }
  if(-not $v2.source_link.chat){ throw "A Fonte Viva não foi confirmada no Chat." }
  if(-not $v2.source_link.lesson){ throw "A Fonte Viva não foi confirmada na Aula." }
  if($v2.source_link.original_upload_endpoint -ne "/api/v3/source/original"){ throw "Endpoint de preservação do PDF original não confirmado." }
  if($v2.source_link.pdf_view_endpoint -ne "/api/v3/source/pdf"){ throw "Endpoint de leitura do PDF original não confirmado." }
  if(-not $v2.source_link.range_requests){ throw "Leitura parcial Range do PDF não foi confirmada." }

  $library50k=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v3/library/status" -TimeoutSec 30
  if(-not $library50k.ok){ throw "A biblioteca incremental 50K não respondeu." }
  if(-not $library50k.base_frozen){ throw "A biblioteca-base não foi confirmada como congelada." }
  if(-not $library50k.append_only){ throw "A camada incremental não foi confirmada como append-only." }
  if(([string]$library50k.incremental.version) -notmatch '50k'){ throw "A arquitetura incremental 50K não foi confirmada." }
  if(-not (Test-Path "C:\ConscienciaFabiano\ImportarPDFs")){ throw "A pasta ImportarPDFs não foi criada." }
  if(-not (Test-Path "C:\ConscienciaFabiano\node_modules\pdfjs-dist")){ throw "O leitor PDF local pdfjs-dist não foi instalado." }
  if($v4.lesson_endpoint -ne "/api/v4/lesson"){ throw "Endpoint da Aula V4 não confirmado." }

  $dict=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/dictionary" -Method Post -ContentType "application/json" -Body '{"query":"Adão","page":1,"page_size":3}' -TimeoutSec 30
  if(-not $dict.ok){ throw "O Dicionário V2 não respondeu após a instalação." }

  # Validação REAL no dispositivo: usa o Qwen local instalado neste Windows.
  $lessonBody=@{
    question="O que é o mundo espiritual?"
    age=12
    mode="aula"
  } | ConvertTo-Json -Compress
  $lesson=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/lesson" -Method Post -ContentType "application/json" -Body $lessonBody -TimeoutSec 300
  if(-not $lesson.ok){ throw "A rota de Aula V4 não respondeu corretamente no teste real." }
  if($lesson.nao_sei){ throw "A V4 foi instalada, mas o Qwen local não conseguiu formar a aula real de validação com duas provas. A instalação não será marcada como validada." }
  if(@($lesson.provas).Count -lt 2){ throw "A aula real retornou menos de duas provas." }
  foreach($proof in @($lesson.provas)){
    if(-not $proof.verified){ throw "A aula real retornou uma prova sem selo verified." }
    if([string]::IsNullOrWhiteSpace([string]$proof.trecho_original)){ throw "A aula real retornou prova sem trecho original." }
    if([string]::IsNullOrWhiteSpace([string]$proof.ref)){ throw "A aula real retornou prova sem referência." }
  }
  if([string]::IsNullOrWhiteSpace([string]$lesson.ideia)){ throw "A aula real retornou ideia vazia." }
  if(([string]$lesson.ideia) -match '^\s*\d'){ throw "A ideia real começou por número de página; validação recusada." }
  if((([string]$lesson.verificacao) -ne "support_quote_literal+entailment_local") -and (([string]$lesson.verificacao) -ne "support_quote_literal+exact-copy-lock")){
    throw "A verificação final da Aula não foi confirmada no teste real."
  }

  # Regressão crítica: a biblioteca já contém centenas de ocorrências de expiação.
  # A instalação só é aceita se a pergunta natural que falhou no dispositivo responder.
  $atonementBody=@{
    question="O que é a expiação?"
    age=12
    mode="aula"
  } | ConvertTo-Json -Compress
  $atonement=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v4/lesson" -Method Post -ContentType "application/json" -Body $atonementBody -TimeoutSec 300
  if(-not $atonement.ok){ throw "Teste de regressão da Expiação não respondeu." }
  if($atonement.nao_sei){ throw "REGRESSÃO: a Aula ainda respondeu 'Não achei na biblioteca' para 'O que é a expiação?'." }
  if(@($atonement.provas).Count -lt 2){ throw "REGRESSÃO: a resposta sobre Expiação retornou menos de duas provas." }
  foreach($proof in @($atonement.provas)){
    if(-not $proof.verified){ throw "REGRESSÃO: a resposta sobre Expiação trouxe prova sem selo verified." }
    if([string]::IsNullOrWhiteSpace([string]$proof.ref)){ throw "REGRESSÃO: a resposta sobre Expiação trouxe prova sem referência." }
  }

  # Teste técnico da voz: Piper, quando disponível, deve produzir WAV. Caso contrário,
  # o navegador continua sendo o fallback, cuja audição depende do dispositivo do usuário.
  $voiceStatus="browser-fallback-pending-user-audio"
  if($v4.tts.ready){
    $wav=Join-Path $env:TEMP ("fns-v4-voice-"+[guid]::NewGuid().ToString("N")+".wav")
    $ttsBody=@{
      ideia=[string]$lesson.ideia
      explicacao=@($lesson.explicacao)
    } | ConvertTo-Json -Compress
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8788/api/v4/tts" -Method Post -ContentType "application/json" -Body $ttsBody -OutFile $wav -TimeoutSec 120
    $wavSize=(Get-Item $wav).Length
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    if($wavSize -le 44){ throw "Piper respondeu, mas o WAV de teste ficou inválido." }
    $voiceStatus="piper-wav-generated"
  }

  $validationDir="C:\ConscienciaFabiano\.fns-local"
  New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
  $validation=[ordered]@{
    validated_at=(Get-Date).ToString("o")
    local_url="http://127.0.0.1:8788"
    v2_version=$v2.version
    v3_version=$v3.version
    v3_evidence_units=$v3.evidence_units
    architecture_50k=$library50k.incremental.version
    incremental_documents=$library50k.incremental.documents
    incremental_blocks=$library50k.incremental.blocks
    mass_import_dir=$library50k.mass_import.import_dir
    base_frozen=$library50k.base_frozen
    append_only=$library50k.append_only
    v4_version=$v4.version
    library_hash=$v4.library_hash
    dictionary_frozen=$v4.dictionary_frozen
    dictionary_query="Adão"
    dictionary_total=$dict.total
    fonte_viva_enabled=$v2.source_link.enabled
    fonte_viva_dictionary=$v2.source_link.dictionary
    fonte_viva_chat=$v2.source_link.chat
    fonte_viva_lesson=$v2.source_link.lesson
    fonte_viva_pdf_view=$v2.source_link.pdf_view_endpoint
    fonte_viva_exact_page=$v2.source_link.exact_pdf_page_fragment
    qwen_model=$lesson.modelo
    semantic_verification=$lesson.verificacao
    lesson_nao_sei=$lesson.nao_sei
    lesson_idea=$lesson.ideia
    atonement_question="O que é a expiação?"
    atonement_nao_sei=$atonement.nao_sei
    atonement_model=$atonement.modelo
    atonement_verification=$atonement.verificacao
    atonement_proofs=@($atonement.provas).Count
    lesson_proofs=@($lesson.provas | ForEach-Object {
      [ordered]@{
        ref=$_.ref
        verified=$_.verified
        idioma_original=$_.idioma_original
        pagina_pdf=$_.pagina_pdf
        pagina_impressa=$_.pagina_impressa
        pagina_tipo=$_.pagina_tipo
      }
    })
    voice_technical_status=$voiceStatus
    mobile_status="pending-user-tailscale-device"
  }
  $validation | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $validationDir "install-validation.json") -Encoding UTF8

  $message="INSTALAÇÃO VALIDADA"+[Environment]::NewLine+[Environment]::NewLine+
    "Local: http://127.0.0.1:8788"+[Environment]::NewLine+
    "V4: "+$v4.version+[Environment]::NewLine+
    "Aula real Qwen: validada com "+@($lesson.provas).Count+" provas"+[Environment]::NewLine+
    "Expiação: RESPONDEU com "+@($atonement.provas).Count+" provas • falso 'não achei' bloqueado"+[Environment]::NewLine+
    "V3 unidades: "+$v3.evidence_units+[Environment]::NewLine+
    "Biblioteca 50K: "+$library50k.incremental.version+[Environment]::NewLine+
    "Pasta massiva: C:\ConscienciaFabiano\ImportarPDFs"+[Environment]::NewLine+
    "Dicionário V2: preservado ("+$dict.total+" ocorrências para Adão)"+[Environment]::NewLine+
    "Fonte Viva: Dicionário + Chat + Aula • PDF original na página citada"+[Environment]::NewLine+
    "Voz técnica: "+$voiceStatus+[Environment]::NewLine+
    "Relatório: C:\ConscienciaFabiano\.fns-local\install-validation.json"+[Environment]::NewLine+
    "Biblioteca hash: "+$v4.library_hash
  Show-Info $message

  Start-Process "http://127.0.0.1:8788/__repair"
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Show-Error $_.Exception.Message
  exit 1
}
