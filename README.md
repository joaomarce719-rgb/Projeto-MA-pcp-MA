# PCP MA · prova de conceito

Começo do sistema (Etapa 1): **login por setor**, **fila e ficha de cada setor**, **concluir etapa** e **devolver ao Design** com histórico, **novo pedido** em 4 passos para o Atendimento e um **modelo de orçamento** para imprimir. Requisitos, regras e o estado de cada item: [docs/REFERENCIA.md](docs/REFERENCIA.md).
Stack: Vite + React + TypeScript (interface), Hono nos Workers da Cloudflare (API), PostgreSQL e login no Supabase.

Documentação das tecnologias: [docs/TECNOLOGIAS.md](docs/TECNOLOGIAS.md).

```
packages/shared  regras compartilhadas (rota dos setores, preço, prazo, Zod) + testes
apps/api         Hono: autenticação, fila, clientes, pedidos, ficha, concluir e devolver
apps/web         login, fila e ficha do setor, novo pedido, orçamento para imprimir
db/              schema.sql (RLS fechado) e seeds
```

## O que já foi verificado (sem Supabase nem Cloudflare)
- `npm test`: regras compartilhadas e a API contra um Postgres de verdade em memória (PGlite), incluindo dois cliques simultâneos (um 200, outro 409), toda rota exigindo login, 403 para quem não tem a permissão (o setor só mexe no próprio pedido; a Direção vê tudo, edita preços e registra pagamentos, mas não abre pedido, não conclui nem devolve etapa e não gerencia usuários), o setor nunca recebendo valores nem dados pessoais do cliente, abrir pedido tudo ou nada, devolver ao Design e acesso fechado para `anon`/`authenticated`.
- `npm run typecheck` nos três pacotes e `npm run build -w apps/web`.
- Telas conferidas no navegador contra a API local com dados de exemplo (`npm run dev:local`): Laser, Design, Atendimento, Direção e Impressão, inclusive em tela de celular.

## O que ainda precisa de contas reais
1. **Supabase:** criar o projeto, rodar `db/schema.sql`, as migrações de `db/migracoes/` em ordem e `db/seed.sql`. O **primeiro Administrador** se cria pelo terminal (no PowerShell, que esconde a senha):
   ```bash
   npm run criar-admin -w apps/api -- pessoa@mafardamentos.com
   ```
   O script pede o nome, a senha inicial (duas vezes, sem aparecer), a chave secreta do Supabase (Configurações do projeto > Chaves de API > `sb_secret_...`) e o endereço de conexão do banco (Database > Connect, com a senha do banco). Os dois segredos também podem vir de `SUPABASE_SERVICE_ROLE_KEY` e `DATABASE_URL`. Nada fica gravado. E-mail que já existe é recusado. Serve também para recuperar o acesso se o único Administrador perder o seu. Depois, troque a senha inicial e ligue a verificação em duas etapas no e-mail dessa pessoa: quem controla a caixa de entrada controla o sistema. Os demais usuários o Administrador cria pela tela Usuários.
2. **Cloudflare:** `powershell -File ..\..\scripts\criar-hyperdrive.ps1` dentro de `apps/api` (usa a Session pooler do Supabase, porta 5432, com cache desligado e a senha pedida sem eco) e colocar o id em `apps/api/wrangler.toml`; ajustar `SUPABASE_URL`. Criar também o balde das fotos: `npx wrangler r2 bucket create pcp-ma-arquivos`.
3. **Chaves** (nunca no git): `apps/web/.env` (veja `.env.example`). A API valida o login com as chaves públicas do Supabase e não guarda segredos no código. Só a tela de Usuários do Administrador precisa da chave de administrador: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (nunca em arquivo nem no chat).
4. **Medir:** tempo de "concluir etapa" com o Supabase em duas regiões (São Paulo e EUA leste) e decidir a região.

## Medir
1. No Supabase, rode `db/seed-medicao.sql` (10 lotes "MEDIÇÃO") e cadastre um usuário com perfil `admin`.
2. Com a API publicada (`npm run deploy -w apps/api`) ou em `npm run dev:api`, rode no terminal (PowerShell):
   ```powershell
   $env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"; $env:SUPABASE_ANON_KEY="..."
   $env:API_URL="https://pcp-ma-api.SEU-SUBDOMINIO.workers.dev"
   $env:MEDIR_EMAIL="admin@..."; $env:MEDIR_SENHA="..."
   node scripts/medir.mjs
   ```
3. Anote os números, troque a região do Supabase (novo projeto), refaça o Hyperdrive e meça de novo.
4. Apague os lotes de medição (comando no fim de `db/seed-medicao.sql`).

## Ver o sistema funcionando sem Supabase nem Cloudflare
Dois terminais, na raiz de `pcp-ma`:

```bash
npm run dev:local   # API de verdade com banco em memória e 5 pedidos de exemplo (http://localhost:8787)
npm run dev:web     # interface (http://localhost:5173), SEM o arquivo apps/web/.env
```

O terminal da API imprime um trecho para colar no console do navegador, que "entra" como atendimento, impressao, laser, design, costura, direcao ou admin. É só para demonstração: o servidor local não vai para a Cloudflare, e os dados somem ao parar.

## Rodar local
```bash
npm install
npm test
npm run dev:api   # http://localhost:8787 (precisa do Hyperdrive configurado)
npm run dev:web   # http://localhost:5173
```

## Pontos para confirmar na prova real
- Que o postgres.js funciona atrás do Hyperdrive. Em `apps/api/src/db.ts` os prepared statements ficam ligados, como a Cloudflare recomenda (`prepare: false` pode travar consultas no Hyperdrive). Rodou contra um Hyperdrive real em 26/10/2026 (medição com `scripts/medir.ps1`, que pede a senha do administrador sem eco).
- Que o projeto Supabase usa chaves de assinatura assimétricas (JWKS). Projetos mais antigos usam segredo compartilhado (HS256) e a verificação em `apps/api/src/auth.ts` precisaria mudar.
- `npm audit` estava em 0 vulnerabilidades em 23/10/2026, depois da atualização das dependências (detalhes em `docs/TECNOLOGIAS.md`, seção 10). Rodar de novo antes de produção.

## Modo demonstração (para testar cada tela, sem contas)
Em dois terminais, na raiz de `pcp-ma/`:

```bash
npm run dev:local   # API local com dados de exemplo (http://localhost:8787)
```

```bash
npm run dev:demo    # interface em modo demonstração (http://localhost:5173)
```

A tela de login mostra os **acessos de demonstração**: um toque entra como Atendimento, Atendimento com permissão de preços (aba Preços), Direção, Administrador ou em qualquer um dos 8 setores (ou digite o usuário, como `design`, com a senha `demo`). Cada setor já tem pelo menos um pedido na fila. Os dados ficam só na memória e somem ao parar a API.
Esse modo só liga com `--mode demo` (arquivo `apps/web/.env.demo`); o build de produção **não** o inclui, e o site publicado continua com o login de verdade.
