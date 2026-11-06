-- Migração 002 · Catálogo de produtos e preços (RF-10, RF-15, RN-07 a RN-10).
-- Roda uma vez no SQL Editor do Supabase, depois da 001. Só acrescenta.
--
-- * produtos: os 46 itens do CATALOGO_MA do sistema atual (os 3 adicionais viram campos fixos no código:
--   patch R$ 7,00, punho R$ 5,00 e gola V R$ 2,00 por peça). Preços em centavos, por peça: faixa de 10 peças ou mais
--   ("maior") e de menos de 10 ("menor"). A faixa é contada por produto (D6).
-- * itens_pedido guarda uma cópia do preço no dia do pedido: mudar o catálogo depois não muda pedido já aberto.
-- * lotes.total_centavos passa a ser calculado pela API a partir dos itens (antes era digitado).

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  malha text not null,
  preco_maior_centavos integer not null check (preco_maior_centavos >= 0),
  preco_menor_centavos integer not null check (preco_menor_centavos >= 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table public.itens_pedido
  add column malha text,
  add column preco_unitario_centavos integer not null default 0 check (preco_unitario_centavos >= 0),
  add column adicionais_unitario_centavos integer not null default 0 check (adicionais_unitario_centavos >= 0),
  add column subtotal_centavos integer not null default 0 check (subtotal_centavos >= 0);

insert into public.produtos (nome, malha, preco_maior_centavos, preco_menor_centavos) values
  ('COLETE INFANTIL DUPLA FACE MALHA HELANCA', 'HELANCA', 4000, 4800),
  ('COLETE ADULTO DUPLA FACE MALHA HELANCA', 'HELANCA', 5000, 6000),
  ('CAMISA INFANTIL MALHA 3D MANGA LONGA', '3D MANGA LONGA', 3500, 4200),
  ('CAMISA INFANTIL MALHA DRY FIT MANGA LONGA', 'DRY FIT MANGA LONGA', 3000, 3600),
  ('CAMISA INFANTIL MALHA HELANCA MANGA LONGA', 'HELANCA MANGA LONGA', 2700, 3240),
  ('TÉRMICA INFANTIL MANGA LONGA MALHA SENSITIVE', 'SENSITIVE', 3500, 4200),
  ('CAMISA INFANTIL MALHA DRY FIT PLUS', 'DRY FIT PLUS', 2500, 3000),
  ('CALÇÃO INFANTIL MALHA 3D', '3D', 2750, 3300),
  ('CALÇÃO INFANTIL MALHA DRY FIT PLUS', 'DRY FIT PLUS', 2500, 3000),
  ('CALÇÃO INFANTIL MALHA HELANCA', 'HELANCA', 2250, 2700),
  ('FAIXA DE CAPITÃO', 'Conforme descrição', 1000, 1500),
  ('CAMISA INFANTIL MALHA 3D', '3D', 2750, 3300),
  ('CAMISA INFANTIL MALHA SENSITIVE', 'SENSITIVE', 2750, 3300),
  ('CAMISA INFANTIL MALHA SOFT TREND', 'SOFT TREND', 2500, 3000),
  ('CAMISA INFANTIL MALHA HELANCA', 'HELANCA', 2250, 2700),
  ('REGATA ADULTO MALHA DRY FIT', 'DRY FIT', 2500, 3000),
  ('GOLA POLO MANGA LONGA MALHA SENSITIVE', 'SENSITIVE', 7000, 8400),
  ('GOLA POLO MANGA LONGA MALHA DRY FIT PLUS', 'DRY FIT PLUS', 6000, 7200),
  ('GOLA POLO MANGA LONGA MALHA PIQUET', 'PIQUET', 6000, 7200),
  ('CAMISA ADULTO MALHA DRY FIT MANGA LONGA', 'DRY FIT MANGA LONGA', 4500, 5400),
  ('CAMISA ADULTO MALHA HELANCA MANGA LONGA', 'HELANCA MANGA LONGA', 4000, 4800),
  ('CALÇA ADULTO MALHA COLEGIAL', 'COLEGIAL', 6000, 7200),
  ('CAMISA MANGA LONGA GOLA ALTA MALHA SENSITIVE', 'SENSITIVE', 6000, 7200),
  ('CAMISA MANGA LONGA C/ BALACLAVA MALHA SENSITIVE', 'SENSITIVE', 7500, 9000),
  ('TÉRMICA MANGA LONGA MALHA SENSITIVE', 'SENSITIVE', 5000, 6000),
  ('CAMISA MANGA LONGA MALHA SENSITIVE', 'SENSITIVE', 5500, 6600),
  ('BERMUDA MALHA COLEGIAL', 'COLEGIAL', 4500, 5400),
  ('BERMUDA MALHA SENSITIVE', 'SENSITIVE', 4500, 5400),
  ('BERMUDA MALHA DRY FIT PLUS', 'DRY FIT PLUS', 3500, 4200),
  ('BERMUDA MALHA HELANCA', 'HELANCA', 3000, 3600),
  ('GOLA POLO MALHA SENSITIVE', 'SENSITIVE', 6000, 7200),
  ('GOLA POLO MALHA 3D', '3D', 6000, 7200),
  ('GOLA POLO MALHA PIQUET', 'PIQUET', 5000, 6000),
  ('GOLA POLO MALHA DRY FIT PLUS', 'DRY FIT PLUS', 5000, 6000),
  ('REGATA ADULTO MALHA DRY FIT PLUS', 'DRY FIT PLUS', 2500, 3000),
  ('CALÇÃO ADULTO MALHA 3D', '3D', 4000, 4800),
  ('CALÇÃO ADULTO MALHA DRY FIT', 'DRY FIT', 3500, 4200),
  ('MACHÃO ADULTO MALHA HELANCA', 'HELANCA', 2000, 2400),
  ('REGATA ADULTO MALHA HELANCA', 'HELANCA', 2000, 3000),
  ('MACHÃO ADULTO DRY FIT PLUS', 'Conforme descrição', 2500, 3000),
  ('CALÇÃO ADULTO MALHA HELANCA', 'HELANCA', 3000, 3600),
  ('CAMISA ADULTO MALHA 3D', '3D', 4500, 5400),
  ('CAMISA ADULTO MALHA SENSITIVE', 'SENSITIVE', 4500, 5400),
  ('CAMISA ADULTO MALHA SOFT TREND', 'SOFT TREND', 3500, 4200),
  ('CAMISA ADULTO MALHA DRY FIT', 'DRY FIT', 3500, 4200),
  ('CAMISA ADULTO MALHA HELANCA', 'HELANCA', 3000, 3600);

alter table public.produtos enable row level security;
revoke all on public.produtos from anon, authenticated;
