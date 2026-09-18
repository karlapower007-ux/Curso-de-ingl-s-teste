# Consciência do Fabiano — Arquitetura de Alta Performance V1

## Fluxo

1. O navegador carrega `pdf.js` e extrai o texto localmente.
2. O Worker não abre, converte nem recebe o PDF binário para indexação.
3. O frontend envia somente JSON com páginas/texto para `/api/trigger-index`.
4. Documentos maiores são enviados em lotes de texto leves.
5. O Durable Object usa `CHUNK_CONCURRENCY = 50` para a fase de chunking.
6. A vetorização usa `EMBED_CONCURRENCY = 50` como teto rígido e `parallelMapLimit()`.
7. `embedOneWithRetry()` usa exponential backoff + jitter em 429/overload.
8. Chunks e embeddings são persistidos no Durable Object SQLite.

## Cofre R2 direto

Quando `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` estão configurados, o Worker gera uma Presigned PUT URL e o navegador envia o PDF original diretamente ao bucket `consciencia-fabiano-pdfs`. O binário não atravessa o Worker.

O workflow aceita os GitHub Secrets opcionais:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Sem essas credenciais, a indexação por texto continua funcionando normalmente e o PDF original permanece no aparelho.

## Proteções

- `/api/admin/upload-pdf` responde HTTP 410.
- `server_pdf_parsing: false` aparece no health.
- O teste de produção usa um PDF real de mais de 5 MB na própria interface.
- O teste falha se houver qualquer request binário do PDF para o Worker.
