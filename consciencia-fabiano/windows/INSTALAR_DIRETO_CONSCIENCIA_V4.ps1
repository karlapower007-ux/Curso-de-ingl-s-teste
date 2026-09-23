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

  $url="https://github.com/karlapower007-ux/Curso-de-ingl-s-teste/archive/refs/heads/consciencia-cloudflare-native-v1.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
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
  if($v4.lesson_endpoint -ne "/api/v4/lesson"){ throw "Endpoint da Aula V4 não confirmado." }

  $dict=Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/v2/dictionary" -Method Post -ContentType "application/json" -Body '{"query":"Adão","page":1,"page_size":3}' -TimeoutSec 30
  if(-not $dict.ok){ throw "O Dicionário V2 não respondeu após a instalação." }

  $message="INSTALAÇÃO VALIDADA"+[Environment]::NewLine+[Environment]::NewLine+
    "Local: http://127.0.0.1:8788"+[Environment]::NewLine+
    "V4: "+$v4.version+[Environment]::NewLine+
    "V3 unidades: "+$v3.evidence_units+[Environment]::NewLine+
    "Dicionário V2: preservado"+[Environment]::NewLine+
    "Biblioteca hash: "+$v4.library_hash
  Show-Info $message

  Start-Process "http://127.0.0.1:8788/?v4=1"
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Show-Error $_.Exception.Message
  exit 1
}
