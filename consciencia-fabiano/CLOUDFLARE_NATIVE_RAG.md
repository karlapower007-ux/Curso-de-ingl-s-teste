# Consciência do Fabiano — Cloudflare Native RAG v1

Esta branch remove a dependência do Render e prepara a versão 1.0 totalmente nativa no Cloudflare.

## Recursos

- Worker: `consciencia-fabiano`
- R2: `consciencia-fabiano-pdfs`
- Vectorize: `consciencia-fabiano-rag`
- D1: `consciencia-fabiano-rag-db`
- Embeddings: `@cf/baai/bge-m3` (1024 dimensões; multilíngue)
- Chat: `@cf/zai-org/glm-4.7-flash`
- STT: `@cf/openai/whisper-large-v3-turbo`
- TTS: `@cf/myshell-ai/melotts`
- PDF -> Markdown: `env.AI.toMarkdown()`

## Ingestão

1. O PDF é validado e armazenado no R2.
2. Workers AI converte cada PDF em Markdown e preserva marcações de página.
3. O Worker separa o documento por página e gera chunks com sobreposição.
4. BGE-M3 gera embeddings multilíngues.
5. Vectorize recebe os vetores.
6. D1 recebe o texto de cada chunk e metadados.
7. As consultas semânticas recuperam chunks e o modelo responde sempre em português.

## Segurança

A versão final deve ser publicada somente depois que o Worker estiver protegido por Cloudflare Access, com política Allow para o proprietário. Como o Access fica na borda, não há tela de senha dentro do aplicativo.

## Importante

O UUID D1 em `wrangler.jsonc` está propositalmente zerado nesta branch. O workflow de provisionamento substituirá esse valor pelo UUID real após a criação do banco.
