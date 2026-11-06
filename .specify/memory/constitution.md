<!--
Sync Impact Report
- Versão: 2.0.0 → 3.0.0 (MAJOR: o princípio I foi redefinido de novo; a Direção deixa de ser só leitura)
- Princípios alterados (mesmos títulos):
  - I: a Direção vê tudo, edita produtos e preços (RN-11) e registra recebimentos, comprovantes e
    entregas; não abre nem altera pedidos e não conclui nem devolve etapas
- Seções adicionadas/removidas: nenhuma
- Histórico do dia: 1.0.0 (adoção) → 1.1.0 (regras da REFERENCIA) → 2.0.0 (Direção lê tudo) → 3.0.0
- Código, RN-11, REFERENCIA §3, TECNOLOGIAS e CLAUDE.md alinhados em 2026-11-05.
Fonte: CLAUDE.md ("Regras que não se negociam"), docs/REFERENCIA.md, docs/TECNOLOGIAS.md.
-->
# PCP MA Constitution

## Core Principles

### I. Só a API decide permissões

- Papel e setor MUST vir da tabela `perfis`, lida a cada requisição; o token só identifica o usuário.
- A interface PODE esconder telas, mas toda permissão MUST ser conferida na API.
- Setor MUST NOT receber valores nem documento/telefone de cliente.
- A Direção vê tudo, incluindo valores, recebimentos, comprovantes e dados de cliente; edita
  produtos e preços e registra recebimentos, comprovantes e entregas. MUST NOT abrir nem alterar
  pedidos, nem concluir ou devolver etapas.
- CPF/CNPJ, telefone e endereço de cliente são dados pessoais (LGPD): só Atendimento, Direção e
  Administrador acessam, e o acesso MUST ficar registrado.
- Cada setor MUST abrir só as fotos dos pedidos que estão com ele.
- Fotos e comprovantes MUST sair só pela API, com permissão conferida; o R2 MUST NOT ter endereço
  público; o tipo do arquivo MUST vir dos bytes.

Motivo: a tela roda no navegador e pode ser burlada; dados de cliente e valores são sensíveis.

### II. Regras em `packages/shared`, com teste

- `packages/shared` é a fonte única das regras de negócio (rota, prazo, preço, orçamento,
  pagamento, quadro, esquemas Zod).
- Regra nova MUST entrar em `packages/shared` com teste antes de entrar na tela ou na API.
- API e interface MUST usar as mesmas funções (`@pcp/shared`); regra duplicada em um lado só é
  proibida.

Motivo: uma regra, um lugar; mudar a regra muda os dois lados ao mesmo tempo.

### III. Integridade dos pedidos e do dinheiro

- O pedido MUST estar em um só lugar por vez, e só o setor onde ele está (ou o Administrador)
  pode concluí-lo.
- Mover pedido MUST ser uma transação com checagem de etapa e de `versao` no `WHERE`; conflito
  MUST responder 409.
- Dinheiro MUST ser inteiro em centavos.
- Datas de entrega MUST usar `AAAA-MM-DD`; "hoje" MUST ser calculado em America/Fortaleza
  (`diaEmFortaleza`).
- O preço MUST ser calculado só no servidor e copiado para `itens_pedido`; mudança de preço
  posterior MUST NOT alterar pedidos antigos.
- Eventos do histórico e recebimentos MUST ser só incluídos, nunca alterados nem apagados; toda
  ação grava quem fez, quando, a etapa e o que foi informado.

Motivo: vários setores mexem no mesmo pedido ao mesmo tempo; erro de valor ou de etapa custa
dinheiro e entrega.

### IV. Banco só muda por migração

- `db/schema.sql` é o esquema da primeira implantação e MUST NOT ser editado.
- Toda mudança MUST entrar como migração numerada em `db/migracoes/` (`NNN_nome.sql`), que só
  acrescenta, é aplicada pelos testes em ordem e rodada no SQL Editor do Supabase.
- RLS fica ligado, sem políticas e sem acesso para `anon`/`authenticated`; só a API lê e grava.
- postgres.js MUST manter prepared statements ligados; parâmetro JSON MUST usar `($n::text)::jsonb`.

Motivo: o banco real já existe; migração só aditiva permite aplicar sem perder dados.

### V. Simples e em português claro

- Mudar só o que foi pedido; sem abstração, opção ou código "para depois" sem uso.
- Erros da API MUST usar 400 (dados inválidos), 401 (sem login), 403 (sem permissão),
  404 (não encontrado), 409 (conflito), com texto em português claro para quem trabalha na fábrica.
- A interface MUST funcionar em celular, tablet e computador, sem instalar nada; a fila do setor é
  feita para o celular, com botões grandes.
- A interface MUST ser usável por teclado, com foco visível, textos para leitor de tela e contraste
  legível nos temas claro e escuro.

Motivo: quem usa e quem mantém o sistema precisa entender a mensagem e o código numa leitura.

## Restrições técnicas e de segurança

- Pilha: npm workspaces; API em Hono no Cloudflare Workers (Hyperdrive, R2); interface Vite +
  React 19 + TanStack Router/Query; Supabase só para login (JWT ES256) e Postgres. Versões em
  `docs/TECNOLOGIAS.md`.
- O Worker no plano grátis tem 10 ms de CPU por requisição; código da API MUST caber nesse limite.
- Segredos MUST ficar fora do git (`.dev.vars`, `.env`) e fora de mensagens e logs.
- A chave `service_role`/`sb_secret_` MUST existir só como segredo do Worker
  (`SUPABASE_SERVICE_ROLE_KEY`), usada só pela tela de Usuários, nunca no navegador nem em erro.
- O modo demonstração MUST NOT entrar no build de produção.
- Arquivos do repositório usam CRLF; edição por script MUST preservar as quebras de linha.
- Depois de trocar a versão maior do React: `npm dedupe` e `npm ls react` com uma cópia só.

## Fluxo de trabalho e portões de qualidade

- Antes de programar: ler `docs/REFERENCIA.md` (RF, RN, decisões D1 a D15, estado das etapas).
- Quando código e `docs/REFERENCIA.md` divergirem, MUST corrigir um dos dois no mesmo trabalho.
  Requisito alterado MUST ser alterado também no documento de requisitos no claude.ai.
- Decisão em aberto (D1 a D15) MUST NOT ser decidida no código: vale o "Enquanto isso" da
  REFERENCIA até a MA responder, e a especificação MUST citar a decisão que assume.
- Todo trabalho MUST terminar com `npm test`, `npm run typecheck` e `npm run build -w apps/web`
  verdes.
- Mudança de regra MUST trazer teste em `packages/shared`; mudança de rota MUST trazer teste de API
  (PGlite com `schema.sql` + migrações).
- Ordem de publicação: migrações no Supabase, depois a API, depois a interface. Publicar a API antes
  das migrações de que ela depende é proibido.
- Testes MUST NOT depender do relógio do computador.

## Governance

- Esta constituição prevalece sobre outras práticas. `CLAUDE.md` e `docs/` dão o detalhe do dia a
  dia e MUST permanecer coerentes com ela.
- Emenda: alterar este arquivo com o motivo, atualizar `CLAUDE.md`/`docs/` afetados e registrar a
  nova versão.
- Versionamento semântico: MAJOR remove ou redefine princípio; MINOR acrescenta princípio ou seção,
  ou amplia regra; PATCH esclarece texto sem mudar sentido.
- Toda especificação, plano e revisão de código MUST conferir os princípios I a V; exceção MUST ser
  justificada por escrito no plano.

**Version**: 3.0.0 | **Ratified**: 2026-11-05 | **Last Amended**: 2026-11-05
