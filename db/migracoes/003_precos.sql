-- Migração 003 · Gerenciamento de preços (RN-11).
-- Roda uma vez no SQL Editor do Supabase, depois da 002. Só acrescenta.
--
-- * perfis.gerencia_precos: o Administrador marca quais pessoas do Atendimento também podem criar produtos e alterar preços.
--   O Administrador sempre pode (pelo papel), então a marca só faz sentido para o Atendimento.
-- * produtos.atualizado_por: quem fez a última alteração (a data já existe em atualizado_em).

alter table public.perfis
  add column gerencia_precos boolean not null default false,
  add constraint gerencia_precos_so_atendimento check (not gerencia_precos or papel = 'atendimento');

alter table public.produtos
  add column atualizado_por uuid references public.perfis(id);
