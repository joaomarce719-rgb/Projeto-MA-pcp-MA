# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# PCP MA

Sistema online de controle de produção da MA Fardamentos (pedidos passam de setor em setor até o financeiro e a entrega).

**Antes de programar, leia [docs/REFERENCIA.md](docs/REFERENCIA.md):** requisitos (RF), regras de negócio (RN), decisões em aberto (D1 a D15), dados, etapas de entrega e o estado do que já está feito. Tecnologias e versões: [docs/TECNOLOGIAS.md](docs/TECNOLOGIAS.md) (inclui o contrato das rotas da API). Como rodar e medir: [README.md](README.md).

## Comandos (na raiz de `pcp-ma/`, npm workspaces)
```bash
npm test                          # regras + API (Postgres em memória, PGlite); leva ~70 s
npm run typecheck                 # os 3 pacotes
npm run build -w apps/web         # tsc + vite build
npm test -w apps/api -- catalogo  # um arquivo de teste (vitest filtra pelo nome); -t "texto" filtra por título
npm test -w packages/shared -- pagamento
npm run dev:local                 # API local (8787) com banco em memória e dados de exemplo, sem Supabase
npm run dev:web                   # interface (5173) sem apps/web/.env, depois "entrar" pelo console (ver README)
npm run dev:demo                  # interface em modo demonstração: login de um toque por setor (senha "demo"); só com dev:local
npm run deploy -w apps/web        # build + wrangler deploy da interface
npm run criar-admin -w apps/api -- pessoa@empresa.com  # primeiro Administrador (ou recuperação): pede senha e segredos sem mostrar; rodar no PowerShell
```
Todo trabalho termina com `npm test`, `npm run typecheck` e `npm run build -w apps/web` verdes.

Antes de publicar a API, confira no SQL Editor do Supabase que todas as migrações de `db/migracoes/` rodaram; a mais recente é a 007 (se der `false`, rode as que faltam antes):
```sql
select exists (select 1 from information_schema.columns where table_name = 'produtos' and column_name = 'faixas') as pode_publicar;
```
Deploy da API (o R2 ainda não está ativo, então se usa um `wrangler.toml` temporário sem `[[r2_buckets]]`; rodar em `apps/api`):
```bash
awk '/^# Balde das fotos/{skip=1} skip&&/^# Criado com scripts/{skip=0} !skip' wrangler.toml > wrangler.sem-r2.toml && npx wrangler deploy -c wrangler.sem-r2.toml; rm -f wrangler.sem-r2.toml
```
`wrangler dev` não alcança o Hyperdrive remoto; para testar contra o banco real, publique o Worker. O Worker no plano grátis tem limite de 10 ms de CPU.

## Arquitetura (visão geral)
- **`packages/shared`** é a fonte única das regras: rota dos setores (`rota.ts`), prazo, preço/orçamento (`preco.ts`, `orcamento.ts`), pagamento (`pagamento.ts`), quadro da Direção (`quadro.ts`), quem vê valores e registra pagamentos (`permissoes.ts`: `veValores`, `registraPagamentos`, `veDadosPessoais`, `abrePedidos`, `veQuadro`, `gerenciaUsuarios`) e os esquemas Zod dos corpos e respostas (`schemas.ts`, `pedido.ts`). API e interface importam as mesmas funções (`@pcp/shared`); mudar uma regra aqui muda os dois lados.
- **`apps/api`** (Hono): `app.ts` monta as rotas e o middleware `autenticar`, ligado em toda rota menos `/health` (um teste percorre todas). `auth.ts` valida o JWT do Supabase (ES256 via JWKS, `jose`) e **só extrai o usuário**; papel e setor são lidos da tabela `perfis` a cada requisição. Cada rota fica em um módulo (`fila`, `ficha`, `pedidos`, `concluir`, `devolver`, `financeiro`, `orcamento`, `catalogo`, `quadro`, `precos`, `fotos`, `usuarios`) que confere a permissão e filtra as colunas (setor sem valores nem dados do cliente). `db.ts` abre o postgres.js pelo Hyperdrive; `armazenamento.ts` fala com o R2; `adminAuth.ts` chama a Admin API do Supabase (só a tela de Usuários).
- **O preço é calculado só no servidor** (`pedidos.ts`): produto do catálogo (`produtos`), faixas de preço por quantidade de cada produto (`produtos.faixas`, `precoDaFaixa`), adicionais por peça; o preço do dia é copiado para `itens_pedido` (a mudança de preço depois não altera pedidos antigos). Quem altera produtos e preços é o Administrador, a Direção ou o Atendimento com `perfis.gerencia_precos` (regra `podeGerenciarPrecos` em `@pcp/shared`, conferida na API).
- **`apps/web`**: Vite + React 19, TanStack Router (`router.tsx` monta o menu por papel; a Direção vê Pedidos, Quadro, Financeiro e Preços) e TanStack Query (`api.ts` concentra as chamadas). Supabase só faz o login; dados vêm sempre da API.
- **Banco** (`db/`): RLS ligado, sem políticas e sem acesso para `anon`/`authenticated` (a Data API está desligada); só a API, pelo Hyperdrive, lê e grava.
- **Testes de API** (`test-support.ts`): sobem um PGlite novo, aplicam `schema.sql` e todas as `db/migracoes/*.sql` em ordem e criam a app com usuários e lotes de exemplo. `dev-local.ts` reaproveita isso para o modo demonstração (o token de demonstração é o id do usuário e só essa API local o aceita; o build de produção não inclui o modo demo).

## Regras que não se negociam
1. **Só a API decide permissões.** Papel e setor vêm da tabela `perfis`, nunca do token. A tela esconde, mas quem protege é a API.
2. **Setor nunca recebe valores nem documento/telefone de cliente.** A Direção vê tudo (valores, recebimentos, comprovantes, dados de cliente), edita produtos e preços e registra pagamentos e entregas; não abre nem altera pedidos, nem conclui ou devolve etapas (REFERENCIA §3, RN-11).
3. **Mover pedido = transação** com checagem de etapa e `versao` (409 em conflito). Nunca atualizar sem esse `WHERE`.
4. **Dinheiro em centavos** (inteiro). Datas de entrega `AAAA-MM-DD`; "hoje" sempre em America/Fortaleza (`diaEmFortaleza`).
5. **Regra nova entra em `packages/shared` com teste** antes de entrar na tela ou na API. Tela e API usam as mesmas funções.
6. **Banco:** `db/schema.sql` é o esquema da primeira implantação (já está no Supabase real) e **não se edita mais**. Toda mudança entra como migração numerada em `db/migracoes/` (`001_financeiro.sql`, `002_catalogo.sql`, `003_…`), que só acrescenta, é rodada no SQL Editor do Supabase e é aplicada pelos testes em ordem depois do `schema.sql` (`test-support.ts`).
   Com o postgres.js real, parâmetro com `$n::jsonb` é codificado duas vezes; use `($n::text)::jsonb` (o banco em memória dos testes não repete esse defeito).
7. **Segredos fora do git** (`.dev.vars`, `.env`). Nunca colar chaves em arquivos versionados nem em mensagens.
8. Conexão com o banco: postgres.js com prepared statements **ligados** (ver `apps/api/src/db.ts`); não usar `prepare: false`.
9. Depois de trocar a versão maior do React: `npm dedupe` e conferir `npm ls react` (uma cópia só).
10. **Fotos e comprovantes só saem pela API**, com a permissão conferida (`GET /fotos/:id`, `GET /recebimentos/:id/comprovante`); o R2 nunca tem endereço público. O tipo do arquivo vem dos bytes.
11. **A chave `service_role`/`sb_secret_` do Supabase** só existe como segredo do Worker (`SUPABASE_SERVICE_ROLE_KEY`) e só a tela de usuários a usa. Vai apenas no cabeçalho `apikey` (e em `Authorization: Bearer` só se começar com `eyJ`). Nunca no código, no navegador ou em mensagens de erro.
12. Os testes não dependem do relógio do computador para passar, mas se a máquina suspender no meio de uma rodada os tempos estouram ("Hook timed out"): rode de novo.
13. Os arquivos do repositório usam CRLF; ao editar por script, preserve as quebras de linha.
14. **Usuário se desativa, nunca se apaga.** `historico` e `acessos_dados_pessoais` guardam quem fez cada ação, e o banco recusa apagar quem tem registro. Pela tela de Usuários, só desativar.
15. **Cliente não se apaga: anonimiza-se**, só pelo Administrador (tela LGPD), depois do prazo de guarda (`PRAZO_DE_GUARDA_ANOS` em `packages/shared/src/lgpd.ts`) e sem pedido em andamento. É a única exceção à regra de não alterar o histórico (constituição, princípio III).

## Mensagens e erros
Erros da API: 400 dados inválidos, 401 sem login, 403 sem permissão, 404 não encontrado, 409 conflito. Texto sempre em português claro, para quem trabalha na fábrica.

## Estado da implantação (o que ainda não foi verificado)
Supabase `pcp-ma` (São Paulo, plano Free só para testes; Pro antes de uso real): `schema.sql` e as migrações `001` a `006` aplicados (002 a 006 em 09/11/2026, pelo conector MCP do Supabase, registradas em `supabase_migrations`); login ES256. Interface em `https://pcp-ma.mafardamentos.workers.dev`; Worker `pcp-ma-api` em `https://pcp-ma-api.mafardamentos.workers.dev` (Hyperdrive `pcp-ma`, cache desligado, Session pooler, **sem R2**).

**Publicado em 09/11/2026:** a Etapa 2 (catálogo, preço no servidor, orçamento, Quadro, aba Preços) e as mudanças de 05 a 09/11 (permissões da Direção, registro de acessos LGPD, pedido de exclusão), na API (versão `26ed94c2`) e na interface (versão `0a0637eb`). Conferido sem login: `/health` 200, rotas protegidas 401, pré-voo CORS 204, login abre sem modo demonstração. Falta conferir com um usuário real (pedido novo, Financeiro, Quadro, LGPD).

**Publicado em 09/11/2026 (2ª vez):** a edição de usuários (RF-04: `POST /usuarios/:id`, `GET /usuarios/:id/alteracoes`), com a migração `006_alteracoes_usuarios.sql` aplicada antes (conferida: tabela, RLS, 2 gatilhos, sem acesso para `anon`/`authenticated`). API versão `09e1fb29`, interface versão `a84f4003`, publicadas do ramo `001-editar-usuarios`. Conferido sem login: `/health` 200, rotas novas 401, pré-voo CORS 204, interface sem modo demonstração. Falta conferir a edição com o Administrador real.

**Verificado em 09/11/2026:** o script `criar-admin` criou um Administrador no Supabase real (login e perfil `admin`, e-mail confirmado), e ele entrou no sistema publicado.

**Não publicado:** as faixas de preço por produto (ramo `002-faixas-de-preco`) dependem da migração `007_faixas_de_preco.sql`, ainda não aplicada no Supabase. Publicar a API antes dela quebra o catálogo, os preços e a criação de pedidos; publicar depois, com intervalo, deixa a API antiga gravando preços sem faixas. Rode a migração e publique a API em seguida, sem mexer na aba Preços entre os dois.

Ainda não rodou contra o banco real: R2/fotos e comprovantes (R2 desativado), o Financeiro com dados reais, e a criação de usuários pela tela (falta o segredo `SUPABASE_SERVICE_ROLE_KEY` no Worker). Os testes usam Postgres em memória. Ver "Pendências" em `docs/TECNOLOGIAS.md`.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
