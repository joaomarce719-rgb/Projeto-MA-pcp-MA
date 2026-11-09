# Implementation Plan: Editar usuários

**Branch**: `001-editar-usuarios` (pasta da especificação; o trabalho segue em `main` até alguém criar o ramo) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-editar-usuarios/spec.md`

## Summary

O Administrador edita nome, papel e setor de um usuário que já existe, pela tela de Usuários (RF-04). A regra de
validação é a mesma da criação (`usuarioBody` em `@pcp/shared`), agora reaproveitada num `edicaoUsuarioBody`. A API
grava a mudança no `perfis` e uma linha no novo registro `alteracoes_usuarios` (migração 006, só inclusões) na mesma
transação; ao sair do Atendimento, `gerencia_precos` volta a `false` na mesma gravação. A tela ganha "Editar" e
"Alterações" em cada usuário. Como papel e setor já são lidos do `perfis` a cada requisição, a mudança vale na próxima.

## Technical Context

**Language/Version**: TypeScript 5 (npm workspaces: `packages/shared`, `apps/api`, `apps/web`)

**Primary Dependencies**: Hono (API no Cloudflare Workers), Zod (esquemas em `@pcp/shared`), React 19 + TanStack Router/Query

**Storage**: Postgres no Supabase, pelo Hyperdrive (postgres.js); testes em PGlite

**Testing**: Vitest (`packages/shared` e `apps/api`, com `schema.sql` + migrações aplicadas em ordem)

**Target Platform**: Cloudflare Workers (API) e navegador (celular, tablet, computador)

**Project Type**: aplicação web (API + interface + regras compartilhadas)

**Performance Goals**: edição e leitura do registro em uma ida ao banco cada; cabe nos 10 ms de CPU do Worker

**Constraints**: só o Administrador; migração só aditiva; registro só com inclusões; CRLF nos arquivos

**Scale/Scope**: dezenas de usuários; poucas edições por mês

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano cumpre | Situação |
|---|---|---|
| I. Só a API decide permissões | `gerenciaUsuarios` conferido nas duas rotas novas; papel e setor continuam lidos do `perfis` a cada requisição (nada no token) | Passa |
| II. Regras em `packages/shared`, com teste | `edicaoUsuarioBody` (mesma regra de nome/papel/setor da criação), `mudancasDoUsuario` e `podeEditarUsuario` em `usuarios.ts` do shared, com teste antes de API e tela | Passa |
| III. Histórico só com inclusões | O registro novo só aceita inclusões (gatilho, como na 004); `historico` não é tocado: ele guarda `usuario_id`, então mostra o nome atual | Passa |
| IV. Banco só por migração | `db/migracoes/006_alteracoes_usuarios.sql`, só acrescenta; RLS ligado e sem acesso para `anon`/`authenticated` | Passa |
| V. Simples e português claro | Duas rotas, um formulário na tela que já existe; erros 400/403/404/409 com as frases da spec | Passa |
| Publicação | Migração 006 no Supabase antes da API; CLAUDE.md passa a conferir a 006 antes de publicar | Passa |

Nenhuma exceção a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/001-editar-usuarios/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── usuarios.ts               # + edicaoUsuarioBody, mudancasDoUsuario, podeEditarUsuario, AlteracaoUsuario
└── usuarios.test.ts          # + testes das regras novas

db/migracoes/
└── 006_alteracoes_usuarios.sql   # tabela alteracoes_usuarios, só inclusões

apps/api/src/
├── usuarios.ts               # + editarUsuario (transação), listarAlteracoes
├── usuarios.test.ts          # + casos da spec (403, 404, 409, 400, registro, sem mudança)
├── acessos.test.ts           # (modelo do teste "o banco recusa alterar/apagar")
└── app.ts                    # + POST /usuarios/:id e GET /usuarios/:id/alteracoes

apps/web/src/
├── api.ts                    # + editarUsuario, alteracoesUsuario
└── pages/Usuarios.tsx        # + editar (Janela) e lista de alterações

docs/REFERENCIA.md, docs/TECNOLOGIAS.md, CLAUDE.md   # RF-04 feito, rotas novas, migração 006
```

**Structure Decision**: segue o desenho de sempre: regra no shared, rota em `usuarios.ts` da API, tela em
`pages/Usuarios.tsx`. Nenhum módulo novo.

## Complexity Tracking

Nada a justificar.
