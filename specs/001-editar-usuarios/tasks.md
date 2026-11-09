# Tasks: Editar usuários

**Input**: `specs/001-editar-usuarios/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)

**Tests**: obrigatórios pela constituição (princípio II e "Fluxo de trabalho"): regra nova com teste no shared, rota nova
com teste de API em PGlite. Escreva o teste antes e veja falhar.

**Formato**: `[ID] [P?] [Story] Descrição`. Arquivos com CRLF (CLAUDE.md, regra 13).

## Phase 1: Setup

- [x] T001 Criar `db/migracoes/006_alteracoes_usuarios.sql` copiando o desenho de `db/migracoes/004_acessos.sql`: tabela `public.alteracoes_usuarios` (`id bigint generated always as identity primary key`, `perfil_id uuid not null references public.perfis(id)`, `alterado_por uuid not null references public.perfis(id)`, `antes jsonb not null`, `depois jsonb not null`, `criado_em timestamptz not null default now()`), índice `(perfil_id, criado_em)`, função + gatilhos que recusam `update`, `delete` e `truncate` com "O registro de alterações de usuários não pode ser alterado nem apagado.", RLS ligado e `revoke all` de `anon`/`authenticated` (inclusive na função). Cabeçalho em português como nas outras migrações. Os testes aplicam a migração sozinhos (`test-support.ts`)

## Phase 2: Foundational (bloqueia todas as histórias)

- [x] T002 [P] Em `packages/shared/src/usuarios.test.ts`, escrever testes de `edicaoUsuarioBody` (nome "A" → "Informe o nome da pessoa."; papel `setor` sem setor → "Escolha o setor desta pessoa."; papel `atendimento` com setor → "Só quem é de setor tem setor."; corpo válido passa, sem `email`/`senha`), de `mudancasDoUsuario` (nada mudou → `null`; só setor mudou → `{ antes: { setor: 'Costura' }, depois: { setor: 'Embalagem' } }`; sair do Atendimento com `gerenciaPrecos: true` inclui `gerenciaPrecos` true → false) e de `podeEditarUsuario` (Administrador mudando o próprio papel para outro → false; mantendo `admin` → true; editando outra pessoa → true). Confirmar que `usuarioBody` continua passando nos testes atuais
- [x] T003 Em `packages/shared/src/usuarios.ts`: extrair os campos `nome`, `papel`, `setor` e a regra do `superRefine` de setor para uso comum; `usuarioBody` passa a usá-los (mesmas mensagens); criar `edicaoUsuarioBody` (`{ nome, papel, setor? }`) + tipo `EdicaoUsuarioBody`; `mudancasDoUsuario(antes, depois)` comparando `nome`, `papel`, `setor`, `gerenciaPrecos` (a edição zera `gerenciaPrecos` quando o papel novo não é `atendimento`); `podeEditarUsuario(editorId, alvoId, papelNovo)`; interface `AlteracaoUsuario` `{ id: string; criadoEm: string; alteradoPor: string; antes: Record<string, unknown>; depois: Record<string, unknown> }`. Já exportado por `packages/shared/src/index.ts` (`export * from './usuarios'`). Rodar `npm test -w packages/shared -- usuarios`
- [x] T004 Em `apps/api/src/usuarios.ts`, criar `editarUsuario(db, perfil, id, body)`: `gerenciaUsuarios` senão 403 "Só o Administrador gerencia usuários."; `podeEditarUsuario` senão 409 "Você não pode tirar de si o papel de Administrador."; `db.transaction`: `select nome, papel, setor, gerencia_precos from perfis where id = $1 for update` (sem linha → 404 "Usuário não encontrado."), `mudancasDoUsuario`; se `null`, devolve `{ ok: true }` sem gravar; senão `update perfis set nome, papel, setor (null se não for setor), gerencia_precos = gerencia_precos and papel_novo = 'atendimento'` e `insert into alteracoes_usuarios (perfil_id, alterado_por, antes, depois)` com `($n::text)::jsonb` (regra 6 do CLAUDE.md). Não mexe em `email` nem `ativo`
- [x] T005 Em `apps/api/src/app.ts`, rota `POST /usuarios/:id` no mesmo molde de `/usuarios/:id/ativo` (UUID inválido → 400 "Usuário inválido.", `lerCorpo(c, edicaoUsuarioBody)`, chama `editarUsuario`, responde `{ ok: true }`). Importar `edicaoUsuarioBody` de `@pcp/shared`. O teste que percorre todas as rotas exigindo login (`api.test.ts`) precisa continuar verde
- [x] T006 Em `apps/web/src/api.ts`, `editarUsuario: (id: string, corpo: EdicaoUsuarioBody) => chamar<{ ok: true }>(`/usuarios/${id}`, corpo)`

**Checkpoint**: `npm test -w apps/api -- usuarios` verde com os testes das fases seguintes escritos.

## Phase 3: User Story 1 - Mudar o setor (P1) 🎯 MVP

**Goal**: o Administrador troca o setor de uma pessoa sem criar outro acesso.

**Independent Test**: trocar Costura → Embalagem e ver a fila e a permissão de concluir seguirem a Embalagem na
próxima requisição.

- [x] T007 [P] [US1] Em `apps/api/src/usuarios.test.ts`: Administrador troca o setor de um usuário de setor → 200; `GET /fila` desse usuário passa a listar só a etapa nova; `POST /lotes/:id/concluir` de um pedido na etapa antiga → recusado; a ficha de um pedido que ele concluiu antes continua mostrando o nome dele; 1 linha em `alteracoes_usuarios` com `alterado_por` = Administrador. Atendimento, Direção e setor chamando a rota → 403; id inexistente → 404; id inválido → 400; edição sem mudança → 200 e nenhuma linha nova
- [x] T008 [US1] Em `apps/web/src/pages/Usuarios.tsx`: botão "Editar" em cada usuário (ativo ou desativado) que abre `components/Janela` com nome, papel e setor preenchidos (setor só aparece quando o papel é `setor`, como no formulário de criação); salvar chama `api.editarUsuario`, invalida a consulta `usuarios` e mostra o erro da API em português; validação de tela com `edicaoUsuarioBody` (mesma regra da API). Rótulos para leitor de tela e foco visível (princípio V)

**Checkpoint**: US1 testável sozinha (quickstart, passos 1 a 4).

## Phase 4: User Story 2 - Mudar o papel (P2)

**Goal**: troca de papel com as mesmas regras da criação, sem o Administrador se rebaixar.

**Independent Test**: setor → Atendimento passa a ver todas as etapas e dados de cliente; volta, deixa de ver.

- [x] T009 [P] [US2] Em `apps/api/src/usuarios.test.ts`: setor → `atendimento` → 200, `setor` fica `null`, `GET /clientes` passa a 200; `atendimento` → `setor` sem setor → 400 "Escolha o setor desta pessoa."; Atendimento com `gerencia_precos = true` → `direcao` → 200 e `gerencia_precos = false`, com `gerenciaPrecos` no antes/depois do registro; Administrador mudando o próprio papel → 409 "Você não pode tirar de si o papel de Administrador." e nada gravado
- [x] T010 [US2] Em `apps/web/src/pages/Usuarios.tsx`, na janela de edição: ao trocar o papel para outro que não `setor`, limpar o setor; quando a pessoa editada é o próprio Administrador, deixar o papel travado em Administrador com a explicação ao lado (a API recusa de qualquer jeito)

## Phase 5: User Story 3 - Ver o que mudou (P3)

**Goal**: o Administrador vê as alterações de cada usuário, a mais recente primeiro.

**Independent Test**: editar o papel duas vezes e ver as duas linhas, com antes e depois.

- [x] T011 [P] [US3] Em `apps/api/src/usuarios.test.ts`: duas edições → `GET /usuarios/:id/alteracoes` traz 2 itens, o mais recente primeiro, com `alteradoPor` (nome), `antes`, `depois`, `criadoEm`; usuário nunca editado → `{ alteracoes: [] }`; não-Administrador → 403; id inexistente → 404; inválido → 400. E o banco recusa `update` e `delete` em `alteracoes_usuarios` (modelo em `apps/api/src/acessos.test.ts`)
- [x] T012 [US3] Em `apps/api/src/usuarios.ts`, `listarAlteracoes(db, perfil, id)`: `gerenciaUsuarios` senão 403; usuário inexistente → 404; `select a.id::text, a.criado_em as "criadoEm", p.nome as "alteradoPor", a.antes, a.depois from alteracoes_usuarios a join perfis p on p.id = a.alterado_por where a.perfil_id = $1 order by a.criado_em desc, a.id desc`
- [x] T013 [US3] Em `apps/api/src/app.ts`, rota `GET /usuarios/:id/alteracoes` (UUID inválido → 400; responde `{ alteracoes }`)
- [x] T014 [US3] Em `apps/web/src/api.ts`, `alteracoesUsuario: (id: string) => chamar<{ alteracoes: AlteracaoUsuario[] }>(`/usuarios/${id}/alteracoes`)`; em `apps/web/src/pages/Usuarios.tsx`, botão "Alterações" que abre uma `Janela` com a lista (data e hora com o formato já usado na tela, quem alterou, "campo: antes → depois" com papel e setor por extenso; vazia → "Nenhuma alteração."). Recarregar a lista depois de salvar uma edição

## Phase 6: User Story 4 - Corrigir o nome (P4)

**Goal**: nome corrigido aparece em todo lugar.

**Independent Test**: corrigir o nome e ver o nome novo na lista de usuários e na ficha de um pedido que a pessoa concluiu.

- [x] T015 [P] [US4] Em `apps/api/src/usuarios.test.ts`: nome "A" → 400 "Informe o nome da pessoa."; nome com espaços nas pontas é gravado sem eles; `GET /lotes/:id` de um pedido concluído por ela mostra o nome novo na linha do tempo; `GET /me` dela traz o nome novo

## Phase 7: Polish & Cross-Cutting

- [x] T016 [P] `docs/REFERENCIA.md`: RF-04 passa a "Feito" (editar nome, papel e setor, com registro de alterações)
- [x] T017 [P] `docs/TECNOLOGIAS.md`: as duas rotas na tabela de rotas (texto de `contracts/api.md`), a tabela `alteracoes_usuarios` na lista de tabelas, a migração 006 na pendência de publicação; tirar "editar nome, papel e setor" das pendências da Etapa 1
- [x] T018 [P] `CLAUDE.md`: a migração mais recente passa a ser a 006, com a consulta `select to_regclass('public.alteracoes_usuarios') is not null as pode_publicar;`; avisar em "Estado da implantação" que a 006 ainda não foi aplicada no Supabase
- [x] T019 Rodar `npm test`, `npm run typecheck` e `npm run build -w apps/web` (todos verdes) e o roteiro manual de `specs/001-editar-usuarios/quickstart.md`; conferir CRLF nos arquivos tocados

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002 → T003 → T004 → T005; T006 depois de T003) → histórias.
- US1, US2, US3, US4 dependem só da fase 2; são independentes entre si. Todas escrevem em `apps/api/src/usuarios.test.ts`
  e US1/US2/US3 em `apps/web/src/pages/Usuarios.tsx`: em paralelo só se uma pessoa cuidar de cada arquivo.
- US3 é a única com rota nova própria (T012, T013).
- Polish depois das histórias escolhidas.

## Parallel Example

```text
# Depois da fase 2, testes de histórias diferentes podem ser escritos juntos (blocos separados do mesmo arquivo):
T007 [US1], T009 [US2], T011 [US3], T015 [US4]
# Documentação, ao final, em paralelo:
T016, T017, T018
```

## Implementation Strategy

1. **MVP**: T001 a T008 (editar setor pela tela, com registro gravado). Já resolve a troca de posto sem criar acesso novo.
2. US2 (papel), depois US3 (ver alterações), depois US4 (só testes: a regra do nome já vem da fase 2).
3. Polish e publicação na ordem: migração 006 no Supabase → API → interface.
