# Research: Editar usuários

Nenhum ponto da Technical Context ficou em aberto. Decisões tomadas lendo o código atual:

## 1. Reaproveitar a validação da criação

- **Decision**: separar em `usuarios.ts` (shared) a parte comum (nome, papel, setor) e a regra "setor só para quem é
  de setor" numa função usada pelo `usuarioBody` e pelo novo `edicaoUsuarioBody`.
- **Rationale**: `usuarioBody` usa `superRefine`, e depois disso o Zod não deixa usar `.pick()`/`.omit()`. A regra
  precisa ser uma só (princípio II).
- **Alternatives considered**: copiar o esquema (regra duplicada, proibido); `edicaoUsuarioBody = usuarioBody.partial()`
  (exigiria e-mail/senha ou aceitaria campos que a edição não muda).

## 2. Onde guardar o registro

- **Decision**: tabela nova `alteracoes_usuarios`, só com inclusões (gatilho que recusa update/delete/truncate, igual à
  `acessos_dados_pessoais` da 004), com `antes` e `depois` em `jsonb` (só nome, papel e setor).
- **Rationale**: o `historico` é por pedido (`lote_id not null`) e não serve. Antes/depois em `jsonb` evita seis
  colunas e aceita o mesmo formato para os três campos.
- **Alternatives considered**: colunas `nome_antes`, `nome_depois`…; registrar só o "depois" (perde o que era).

## 3. Atomicidade

- **Decision**: `db.transaction`: `select … for update` do perfil, compara, `update perfis`, `insert` no registro.
  Sem mudança, não grava nada e responde 200.
- **Rationale**: a mudança sem registro (ou o contrário) não pode existir. O `for update` deixa duas edições
  simultâneas em fila; vale a última, como diz a spec.
- **Alternatives considered**: checagem de `versao` no perfil (a spec aceita "a última vale"; seria uma coluna nova
  sem pedido).

## 4. Administrador tirando o próprio papel

- **Decision**: `podeEditarUsuario(editorId, alvoId, novoPapel)` no shared recusa quando o Administrador muda o próprio
  papel para outro; a API responde 409 com "Você não pode tirar de si o papel de Administrador.".
- **Rationale**: mesmo motivo de `mudarAtivo` (o sistema nunca fica sem quem o administre).

## 5. Gerenciar preços

- **Decision**: `update perfis set … gerencia_precos = gerencia_precos and $papel = 'atendimento'`.
- **Rationale**: o banco já recusa `gerencia_precos` fora do Atendimento (003); zerar na mesma gravação evita o erro.
  Se mudou, entra no registro como parte do "antes/depois" (`gerenciaPrecos`).
