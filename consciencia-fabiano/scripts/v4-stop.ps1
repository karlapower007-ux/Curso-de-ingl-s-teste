$ErrorActionPreference = "SilentlyContinue"

# Regra do projeto: parar somente o Node que escuta a porta 8788.
# Ollama NÃO é encerrado.
$listeners = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
$stopped = 0
foreach ($l in @($listeners)) {
  $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -match "^node") {
    Stop-Process -Id $p.Id -Force
    $stopped++
  }
}
exit 0
