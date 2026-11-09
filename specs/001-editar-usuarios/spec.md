# Feature Specification: Editar usuários

**Feature Branch**: `001-editar-usuarios`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Editar usuários que já existem (RF-04): o Administrador muda nome, papel e setor de uma pessoa já cadastrada pela tela de Usuários. Papel e setor continuam lidos da tabela perfis a cada requisição; usuário nunca se apaga, só se desativa."

## Clarifications

### Session 2026-11-09

- Q: Guardar quem alterou cada usuário, quando, e os valores de antes e depois? → A: Sim, num registro que só aceita inclusões.
- Q: O registro de alterações aparece na tela de Usuários ou só fica guardado? → A: Aparece na tela, para o Administrador, por usuário.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mudar o setor de quem trocou de posto (Priority: P1)

Uma costureira passa a trabalhar na Embalagem. O Administrador abre a tela de Usuários, escolhe a pessoa, troca o setor
e salva. Na próxima tela que ela abrir, a fila já é a da Embalagem; o histórico dos pedidos que ela concluiu na Costura
continua com o nome dela.

**Why this priority**: É a mudança mais comum na fábrica. Hoje a única saída é desativar e criar outro acesso, e a
pessoa vira duas no histórico.

**Independent Test**: Trocar o setor de um usuário de setor e conferir que a fila dele passa a mostrar só a nova etapa
e que ele não conclui mais pedidos da etapa antiga.

**Acceptance Scenarios**:

1. **Given** um usuário de setor da Costura, **When** o Administrador muda o setor para Embalagem e salva, **Then** a
   próxima requisição desse usuário já é tratada como Embalagem, sem precisar sair e entrar de novo.
2. **Given** o mesmo usuário, **When** ele tenta concluir um pedido que está na Costura, **Then** recebe a recusa de
   quem não trabalha naquela etapa.
3. **Given** pedidos que ele concluiu antes da troca, **When** alguém abre a ficha, **Then** a linha do tempo continua
   mostrando o nome dele naquelas etapas.

---

### User Story 2 - Mudar o papel de uma pessoa (Priority: P2)

Uma pessoa do Atendimento passa para a Direção (ou alguém de setor passa para o Atendimento). O Administrador troca o
papel; o que ela vê e pode fazer muda na próxima requisição.

**Why this priority**: Acontece menos que a troca de setor, mas mexe em permissões e em dados de cliente e valores,
então precisa das mesmas regras de quem cria o usuário.

**Independent Test**: Trocar o papel de setor para atendimento e conferir que a pessoa passa a ver os pedidos de todas
as etapas e os dados do cliente; trocar de volta e conferir que deixa de ver.

**Acceptance Scenarios**:

1. **Given** um usuário de setor, **When** o papel muda para Atendimento, **Then** o setor dele fica vazio e ele passa
   a ter as permissões do Atendimento.
2. **Given** um usuário do Atendimento, **When** o papel muda para setor sem escolher um setor, **Then** a gravação é
   recusada com "Escolha o setor desta pessoa."
3. **Given** uma pessoa do Atendimento com a permissão de gerenciar preços, **When** o papel muda para qualquer outro,
   **Then** essa permissão é retirada junto.
4. **Given** o Administrador editando o próprio cadastro, **When** tenta tirar de si o papel de Administrador,
   **Then** a gravação é recusada, para o sistema nunca ficar sem quem o administre.

---

### User Story 3 - Ver o que mudou num usuário (Priority: P3)

Surge uma dúvida ("desde quando ela vê valores?"). O Administrador abre o usuário na tela de Usuários e vê a lista de
alterações: quando, quem alterou e o que mudou.

**Why this priority**: Dá rastro às mudanças de permissão, que liberam valores e dados de cliente.

**Independent Test**: Editar o papel de um usuário duas vezes e conferir que a tela mostra as duas alterações, a mais
recente primeiro, com antes e depois.

**Acceptance Scenarios**:

1. **Given** um usuário editado duas vezes, **When** o Administrador abre as alterações dele, **Then** vê as duas, a
   mais recente primeiro, com data, hora, quem alterou e os valores de antes e depois.
2. **Given** um usuário nunca editado, **When** o Administrador abre as alterações, **Then** vê "Nenhuma alteração."
3. **Given** uma pessoa que não é Administrador, **When** pede as alterações de um usuário, **Then** é recusada (403).
4. **Given** uma edição que não mudou nada, **When** é gravada, **Then** nenhuma alteração entra no registro.

---

### User Story 4 - Corrigir o nome (Priority: P4)

O nome foi digitado errado ou a pessoa prefere outro. O Administrador corrige; o nome novo aparece no menu dela, na
lista de usuários e no histórico dos pedidos.

**Why this priority**: Correção simples, sem efeito em permissões.

**Independent Test**: Corrigir o nome e conferir que a lista de usuários e a ficha de um pedido que ela concluiu
mostram o nome novo.

**Acceptance Scenarios**:

1. **Given** um usuário, **When** o Administrador grava o nome com menos de 2 letras, **Then** a gravação é recusada
   com "Informe o nome da pessoa."
2. **Given** um nome corrigido, **When** alguém abre a ficha de um pedido que essa pessoa concluiu, **Then** aparece o
   nome novo.

---

### Edge Cases

- Usuário desativado: pode ser editado (o Administrador corrige antes de reativar); continua desativado.
- Usuário que não existe (apagado no meio, endereço inventado): "Usuário não encontrado." (404).
- Dois Administradores editando a mesma pessoa ao mesmo tempo: a última gravação vale, já que não há pedido em jogo.
- Pessoa de setor com pedidos que ela mesma estava trabalhando: a troca não mexe nos pedidos; eles continuam na etapa
  em que estão e passam a ser trabalhados por quem é daquele setor.
- Edição que não muda nada: aceita, sem erro, e sem linha no registro de alterações.
- E-mail e senha: não fazem parte desta edição (senha já tem a sua tela; e-mail é o login).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Só o Administrador MUST poder editar usuários; qualquer outro perfil recebe "Só o Administrador gerencia
  usuários." (403), conferido no servidor.
- **FR-002**: O Administrador MUST poder mudar nome, papel e setor de um usuário que já existe, ativo ou desativado.
- **FR-003**: As regras de nome, papel e setor MUST ser as mesmas da criação de usuário: nome com 2 a 80 letras; setor
  obrigatório para quem é de setor e proibido para os demais.
- **FR-004**: Ao sair do papel Atendimento, a permissão de gerenciar preços MUST ser retirada na mesma gravação.
- **FR-005**: O Administrador MUST NOT poder tirar de si mesmo o papel de Administrador (409).
- **FR-006**: A mudança MUST valer na próxima requisição da pessoa editada, sem precisar sair e entrar.
- **FR-007**: A edição MUST NOT apagar nem reescrever o histórico dos pedidos; o histórico aponta para a pessoa, e por
  isso mostra o nome atual.
- **FR-008**: E-mail, senha e situação (ativo/desativado) MUST NOT mudar por esta edição.
- **FR-009**: Cada edição MUST ficar registrada com quem editou, quando, e os valores de antes e depois de nome, papel
  e setor. O registro só aceita inclusões: não se altera nem se apaga.
- **FR-010**: Na tela de Usuários, o Administrador MUST ver, para cada usuário, as alterações registradas (FR-009),
  da mais recente para a mais antiga: quando, quem alterou e o que mudou (antes e depois). Nenhum outro perfil vê.
- **FR-011**: Mensagens de erro MUST ser em português claro, como o resto do sistema.

### Key Entities

- **Usuário (perfil)**: a pessoa que entra no sistema. Nome, e-mail (login), papel (atendimento, setor, direção,
  administrador), setor (só para papel setor), ativo, e se gerencia preços (só Atendimento).
- **Alteração de usuário**: quem editou, quando, quem foi editado, valores antes e depois.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O Administrador troca o setor de uma pessoa em menos de 30 segundos, sem criar outro acesso.
- **SC-002**: Depois da troca, 100% das ações da pessoa seguem o perfil novo já na próxima tela que ela abrir.
- **SC-003**: Nenhuma pessoa aparece duplicada no histórico por ter trocado de setor ou de papel.
- **SC-004**: Nenhum perfil diferente do Administrador consegue editar usuários, nem chamando o servidor direto.

## Assumptions

- O nome mostrado no histórico é o nome atual da pessoa (o histórico guarda quem fez, não o nome escrito na época).
- O nome no sistema de login não precisa acompanhar a mudança: o sistema lê o nome do perfil.
- Não há trava contra edição simultânea de usuário: a última gravação vale.
- A tela de Usuários que já existe recebe a edição e a lista de alterações; não há tela nova.
