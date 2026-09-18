# Consciência do Fabiano

Projeto pessoal e privado, derivado apenas das partes estáveis do baseline FNS Digital Human.

## Objetivo
- Conversa sempre em português brasileiro.
- Biblioteca RAG com PDFs em qualquer idioma.
- Referências por arquivo e página quando disponíveis.
- Voz com STT em português e TTS do backend, com fallback do navegador.
- Memória local de conversa.
- Avatar leve de três estados: fechado, falando e aberto.
- Área privada de biblioteca para upload, listagem, reindexação e exclusão de PDFs.

## Arquitetura
Frontend/Proxy: Cloudflare Worker `consciencia-fabiano`.
Backend RAG: `https://avatar-fabiano-api.onrender.com`.
Fallback conversacional: Cloudflare Workers AI (`@cf/openai/gpt-oss-120b`).
STT: Cloudflare Whisper Large v3 Turbo.

O token privado nunca é gravado no repositório. Apenas o SHA-256 da chave fica no Worker. O navegador envia a chave somente por HTTPS e a mantém localmente após o primeiro acesso.

## Origem técnica
A branch foi criada a partir do baseline estável:
`b39633ee30d4396803767376b6a30bd5c55ea086`.

Emma e Olivia não são alteradas por este projeto.
