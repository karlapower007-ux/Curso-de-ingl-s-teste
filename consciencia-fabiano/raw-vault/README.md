# Consciência do Fabiano V3.3 — Raw Vault (Plano F)

Esta pasta é o fallback absoluto de leitura humana. O script `npm run fallback:export` transforma o cofre estático comprimido do Plano D em ficheiros Markdown legíveis em `raw-vault/generated/`.

O navegador não pode abrir pastas locais silenciosamente por regras de segurança do sistema operativo. Por isso, o Plano F é deliberadamente humano e zero-code: se todas as camadas A-E falharem, abra diretamente os ficheiros `.md` ou `.txt` desta pasta.

Nenhuma IA é necessária para ler o conteúdo exportado.

## Plano C V3.1

Antes de chegar a este cofre, o Plano C usa um pool de Web Workers governado por `navigator.hardwareConcurrency`. A capacidade lógica é de 1000 tarefas e a concorrência física é limitada para preservar a main thread. A seleção offline usa BM25/IDF, cobertura de termos, frase exata e proximidade, sem depender de Groq.

## Precisão estrita V3.3

No Plano C, referências diretas usam filtro booleano exato. Pesquisas gerais só atravessam o corte quando atingem BM25 >= 3.25 e cobertura >= 0,50. Quando nenhum candidato satisfaz essas regras, a execução local termina em silêncio elegante, sem preencher a tela com aproximações.
