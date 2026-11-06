-- PCP MA · esquema mínimo da prova de conceito (PostgreSQL / Supabase)
-- Como usar: Supabase > SQL Editor > New query > colar tudo > Run.
-- Depois crie os usuários em Authentication > Users e cadastre os perfis (exemplo no fim de seed.sql).
--
-- Desenho de segurança:
--  * Só a API fala com o banco (pela conexão do Hyperdrive, que ignora o RLS).
--  * RLS ligado em todas as tabelas, sem nenhuma política, e sem permissão para anon/authenticated:
--    a chave pública do Supabase, que vai no navegador, não lê nem grava nada.

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  -- E-mail do login, para a lista de usuários do Administrador (o login em si fica no Supabase Auth).
  email text,
  papel text not null check (papel in ('atendimento', 'setor', 'direcao', 'admin')),
  setor text check (setor in ('Design', 'Impressão', 'Batida', 'Laser', 'Conferência', 'Bordado', 'Costura', 'Embalagem')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint setor_obrigatorio check (papel <> 'setor' or setor is not null)
);

create unique index perfis_email_idx on public.perfis (lower(email)) where email is not null;

-- Dados pessoais (LGPD): só atendimento, direção e admin leem, pela API. O setor nunca recebe documento nem telefone.
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) >= 3),
  documento text,
  telefone text,
  cidade text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
-- Um documento (CPF/CNPJ) identifica um só cliente; vários clientes sem documento são permitidos.
create unique index clientes_documento_idx on public.clientes (documento) where documento is not null;

create table public.lotes (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  tipo text not null check (tipo in ('Cliente', 'Feira')),
  -- Pedido de Cliente: nome do cliente (copiado na abertura, para o setor ver sem acessar a tabela clientes).
  -- Pedido de Feira: a descrição da feira.
  descricao text not null,
  cliente_id uuid references public.clientes(id),
  quantidade integer not null check (quantidade > 0),
  prioridade text not null default 'Normal' check (prioridade in ('Urgente', 'Alta', 'Normal')),
  data_entrega date not null,
  bordado boolean not null default false,
  punho text not null default 'Sem punho'
    check (punho in ('Sem punho', 'Punho ribana', 'Punho na mesma malha', 'Punho com listra')),
  detalhes text,
  etapa text not null default 'Design'
    check (etapa in ('Design', 'Impressão', 'Batida', 'Laser', 'Conferência', 'Bordado', 'Costura', 'Embalagem', 'Financeiro', 'Concluído')),
  recuperacao_pendente boolean not null default false,
  recuperacoes integer not null default 0,
  entregue integer,
  finalizado_em timestamptz,
  -- sobe a cada movimentação; a API só grava se a versão ainda for a que a pessoa viu
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index lotes_etapa_idx on public.lotes (etapa);

-- Produtos do pedido. A grade (tamanho → quantidade) é validada pela API; `quantidade` é a soma, calculada pela API.
create table public.itens_pedido (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.lotes(id) on delete cascade,
  ordem integer not null,
  produto text not null,
  modo text not null check (modo in ('adulto', 'infantil')),
  grade jsonb not null,
  quantidade integer not null check (quantidade > 0),
  adicionais jsonb not null default '{"patch": false, "punho": false, "golaV": false}',
  unique (lote_id, ordem)
);

-- Fotos de referência do pedido. O arquivo fica no armazenamento privado (R2); aqui só a chave e os dados.
create table public.fotos (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.lotes(id) on delete cascade,
  chave text not null unique,
  nome text,
  tipo text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp')),
  tamanho integer not null check (tamanho > 0),
  enviado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
create index fotos_lote_idx on public.fotos (lote_id);

create table public.historico (
  id bigint generated always as identity primary key,
  lote_id uuid not null references public.lotes(id) on delete cascade,
  etapa text not null,
  tipo text not null default 'Conclusão' check (tipo in ('Cadastro', 'Conclusão', 'Recuperação', 'Finalização')),
  nota text,
  maquina text,
  pecas integer,
  usuario_id uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
create index historico_lote_idx on public.historico (lote_id);

-- Acesso fechado: nada para a chave pública, nem agora nem em tabelas futuras.
alter table public.perfis enable row level security;
alter table public.clientes enable row level security;
alter table public.lotes enable row level security;
alter table public.itens_pedido enable row level security;
alter table public.fotos enable row level security;
alter table public.historico enable row level security;

revoke all on public.perfis, public.clientes, public.lotes, public.itens_pedido, public.fotos, public.historico from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
