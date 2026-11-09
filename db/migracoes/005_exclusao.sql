-- Migração 005 · Pedido de exclusão e anonimização de cliente (LGPD art. 18, com o prazo de guarda do art. 16, I).
-- Roda uma vez no SQL Editor do Supabase, depois da 004. Só acrescenta; não apaga nem altera dados.
--
-- * exclusao_pedida_*: o Administrador registra que o cliente pediu a exclusão (quem registrou, quando e o motivo, com o
--   canal). Dentro do prazo de guarda o pedido é recusado com a data a partir da qual os dados serão anonimizados.
-- * anonimizado_*: quem anonimizou e quando. É a prova de que o pedido foi atendido. Depois disso o nome do cliente vira
--   "Cliente removido", documento, telefone e cidade ficam vazios, e ele some da busca.
-- Nada é apagado: pedidos, pagamentos e o registro de acessos continuam, sem levar mais a ninguém.

alter table public.clientes
  add column exclusao_pedida_em timestamptz,
  add column exclusao_pedida_por uuid references public.perfis(id),
  add column exclusao_motivo text check (exclusao_motivo is null or char_length(exclusao_motivo) <= 500),
  add column anonimizado_em timestamptz,
  add column anonimizado_por uuid references public.perfis(id),
  add constraint anonimizado_so_com_pedido check (anonimizado_em is null or exclusao_pedida_em is not null);

create index clientes_exclusao_idx on public.clientes (exclusao_pedida_em) where exclusao_pedida_em is not null;
