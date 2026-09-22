# Consciência do Fabiano v2 — Local-first

A v2 preserva o baseline v10.1 e adiciona um caminho local independente de provedores pagos.

## Resultado da arquitetura

- PDFs e chunks podem permanecer no dispositivo.
- Ollama em `localhost:11434` é o cérebro padrão.
- Modelos de resposta: `qwen3.8:27b`, `qwen3:8b`, `qwen3:4b`, `qwen3:1.7b` e `qwen3:0.6b`, com seleção automática pela memória disponível e pelos modelos instalados.
- Embeddings separados do LLM: `qwen3-embedding:0.6b`.
- A geração antiga de vetores não é apagada. A v2 cria `fns_qwen_vectors_v2` em paralelo no IndexedDB.
- O espelho lexical continua em OPFS/SQLite.
- Dicionário strict AND exige todos os conceitos no mesmo bloco e pagina sem teto lógico artificial.
- Cinco modos de resposta: Resposta curta, Explicação, Comparar fontes, Linha do tempo e Citação exata.
- Citação exata usa bypass físico do LLM.
- Service Worker permite `/api/v2/*` no modo offline somente quando a PWA está sendo servida pelo backend local do próprio dispositivo.

## Instalação local

1. Instale o Ollama para o seu sistema.
2. Prepare o modelo de embeddings:

```bash
ollama pull qwen3-embedding:0.6b
```

3. Instale pelo menos um cérebro local. Para máquina muito limitada:

```bash
ollama pull qwen3:0.6b
```

Alternativas conforme o hardware:

```bash
ollama pull qwen3:1.7b
ollama pull qwen3:4b
ollama pull qwen3:8b
ollama pull qwen3.8:27b
```

4. Na pasta `consciencia-fabiano`:

```bash
npm install
npm start
```

5. Abra:

```text
http://127.0.0.1:8788
```

O servidor local também verifica automaticamente quais modelos estão instalados.

## Celular na mesma rede local

Para permitir que outro aparelho da mesma rede acesse o servidor local:

### Windows PowerShell

```powershell
$env:FNS_HOST="0.0.0.0"
npm start
```

### Linux/macOS

```bash
FNS_HOST=0.0.0.0 npm start
```

Abra no celular o IP local do computador na porta 8788. O processamento do LLM continua ocorrendo no PC via Ollama; a pergunta não precisa sair da rede local.

> Observação: instalação PWA e Service Worker em um endereço LAN HTTP dependem das regras de contexto seguro do navegador. Em `localhost` no computador o funcionamento é direto. Para PWA instalável via LAN no celular, use uma origem HTTPS local confiável.

## Migração segura dos embeddings

A v2 não sobrescreve a geração MiniLM. Ao escolher **Preparar cérebro local**, ela:

1. lê os chunks existentes do IndexedDB da biblioteca;
2. gera embeddings com `qwen3-embedding:0.6b` via Ollama local;
3. grava os novos vetores no banco paralelo `fns_qwen_vectors_v2`;
4. mantém a biblioteca e os vetores antigos disponíveis para rollback.

## APIs locais

- `GET /api/v2/health`
- `GET /api/v2/models`
- `POST /api/v2/dictionary`
- `POST /api/v2/embed`
- `POST /api/v2/chat`

O modo `exact` de `/api/v2/chat` termina no recuperador literal antes de qualquer seleção ou chamada de modelo.

## Validação

```bash
npm run v2:test
npm run check
```

O primeiro comando testa especificamente os invariantes da v2. O segundo também mantém todos os gates de regressão do v10.1 e o dry-run do Worker.

## Preservação

Esta branch não deve apagar, sobrescrever ou reindexar destrutivamente R2, Durable Objects ou a biblioteca homologada. A versão cloud v10.1 continua sendo o baseline de rollback enquanto a v2 local-first é validada.
