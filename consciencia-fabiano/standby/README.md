# V3 Multi-Cloud Standby (Plano B)

Este diretório contém um clone de contingência compatível com Vercel Edge e Deno Deploy. Ele expõe `/health`, `/api/chat` e `/api/rag/direct`, usando apenas segredos no servidor.

Segredos necessários em cada provedor: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e, para síntese, `GROQ_API_KEY`.

Depois do deploy, configure `VERCEL_STANDBY_URL` e/ou `DENO_STANDBY_URL` no workflow de produção. O build gera `public/failover-manifest.json` sem expor chaves.

Sem URL configurada, o Plano B fica preparado porém inativo e o cliente segue automaticamente para o Plano C.
