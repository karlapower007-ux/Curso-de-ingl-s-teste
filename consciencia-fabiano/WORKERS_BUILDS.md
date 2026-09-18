# Workers Builds — Consciência do Fabiano v1

A branch `consciencia-cloudflare-native-v1` está preparada para usar o CI/CD nativo da Cloudflare e não depende de secrets do GitHub Actions.

Configuração planejada do Worker existente:

- Git repository: `karlapower007-ux/Curso-de-ingl-s-teste`
- Production branch: `consciencia-cloudflare-native-v1`
- Root directory: `consciencia-fabiano`
- Build command: `npm run build`
- Deploy command: `npm run cf:deploy`

O deploy command executa o bootstrap idempotente:
1. valida a identidade do build;
2. cria/reutiliza R2 `consciencia-fabiano-pdfs`;
3. cria/reutiliza Vectorize `consciencia-fabiano-rag`;
4. cria/reutiliza D1 `consciencia-fabiano-rag-db`;
5. injeta o UUID real do D1 no `wrangler.jsonc` apenas no ambiente de build;
6. aplica `migrations/0001_init.sql`;
7. executa QA de sintaxe/arquitetura;
8. publica o Worker.

A versão estável não deve ser substituída até o bootstrap concluir com sucesso.
