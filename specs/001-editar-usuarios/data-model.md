# Data Model: Editar usuários

## perfis (já existe, não muda de forma)

| Campo | Regra na edição |
|---|---|
| `nome` | 2 a 80 caracteres, sem espaços nas pontas |
| `papel` | `atendimento`, `setor`, `direcao`, `admin`; o Administrador não tira de si o `admin` |
| `setor` | obrigatório se `papel = 'setor'`, vazio nos demais |
| `gerencia_precos` | volta a `false` se o papel deixa de ser `atendimento` |
| `email`, `ativo` | não mudam pela edição |

## alteracoes_usuarios (nova, migração 006)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | bigint identity | chave |
| `perfil_id` | uuid → `perfis(id)` | quem foi alterado; sem `on delete cascade` |
| `alterado_por` | uuid → `perfis(id)` | o Administrador que gravou |
| `antes` | jsonb | só os campos que mudaram, com o valor antigo (`nome`, `papel`, `setor`, `gerenciaPrecos`) |
| `depois` | jsonb | os mesmos campos, com o valor novo |
| `criado_em` | timestamptz, default `now()` | quando |

- Índice `(perfil_id, criado_em)` para a lista por usuário.
- Só inclusões: gatilho recusa `update`, `delete` e `truncate` ("O registro de alterações de usuários não pode ser
  alterado nem apagado.").
- RLS ligado, sem políticas; `revoke all` de `anon` e `authenticated`.
- Edição sem mudança não gera linha.

## Tipos em `@pcp/shared`

- `EdicaoUsuarioBody`: `{ nome, papel, setor? }` (mesmas mensagens da criação).
- `AlteracaoUsuario`: `{ id, criadoEm, alteradoPor (nome), antes, depois }` (para a tela).
- `mudancasDoUsuario(antes, depois)`: `{ antes, depois }` só com o que mudou, ou `null` se nada mudou.
