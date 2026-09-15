# FNS Digital Human

Branch de desenvolvimento controlada pelo ChatGPT para o projeto Estudos Profundos FNS Idiomas.

## Estado atual
- Frontend atual: Hugging Face Space `estudosprofundosfns/fns-digital-human`
- Worker atual: `fns-stt`
- Backend atual: `https://fns-stt.karlapower007.workers.dev`
- Endpoints: `GET /health`, `POST /stt`, `POST /tts`, `POST /chat`
- LLM: `@cf/openai/gpt-oss-120b`
- STT: `@cf/openai/whisper-large-v3-turbo`
- TTS atual previsto: `@cf/myshell-ai/melotts`
- Emma por texto e STT já funcionam; próxima prioridade: TTS remoto.

## Estrutura-alvo
- `web/` frontend estático
- `worker/` Cloudflare Worker
- `docs/` diagnóstico e arquitetura

## Regra de segurança
Não quebrar `/chat` nem a versão funcional da Emma ao trabalhar no STT/TTS.
