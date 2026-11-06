-- Migração 001 · Financeiro e entrega (RF-12, RF-25 a RF-28, RN-24 a RN-32).
-- Roda uma vez no SQL Editor do Supabase, depois do schema.sql. Só acrescenta; não apaga nem altera dados.
--
-- * lotes.total_centavos: valor do pedido. Por enquanto é digitado pelo Atendimento; na Etapa 2 o catálogo calcula.
--   Pedidos antigos ficam com zero (sem o que cobrar).
-- * recebimentos: cada entrada de dinheiro, com forma, momento e comprovante. Nunca é editado nem apagado (RN-32).

alter table public.lotes
  add column total_centavos integer not null default 0 check (total_centavos >= 0);

create table public.recebimentos (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.lotes(id) on delete cascade,
  valor_centavos integer not null check (valor_centavos > 0),
  forma text not null check (forma in ('Pix', 'Dinheiro', 'Cartão', 'Boleto', 'Transferência')),
  -- 'Entrada' = registrada na abertura do pedido; 'Financeiro' = depois da Embalagem (RN-29)
  momento text not null check (momento in ('Entrada', 'Financeiro')),
  -- O arquivo fica no armazenamento privado (R2); aqui só a chave e os dados.
  comprovante_chave text unique,
  comprovante_tipo text check (comprovante_tipo in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  comprovante_tamanho integer check (comprovante_tamanho > 0),
  comprovante_nome text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
create index recebimentos_lote_idx on public.recebimentos (lote_id);
create index recebimentos_data_idx on public.recebimentos (criado_em);

-- Mesmo desenho de segurança das outras tabelas: só a API (pela conexão do Hyperdrive) lê e grava.
alter table public.recebimentos enable row level security;
revoke all on public.recebimentos from anon, authenticated;
