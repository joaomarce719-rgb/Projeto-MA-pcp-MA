-- Migração 004 · Registro de acesso a dados pessoais (RNF-02, LGPD).
-- Roda uma vez no SQL Editor do Supabase, depois da 003. Só acrescenta; não apaga nem altera dados.
--
-- * acessos_dados_pessoais: uma linha por cliente cujo CPF/CNPJ e telefone a API entregou completos a alguém (ficha e
--   orçamento), com quem, quando, por qual tela e de qual pedido. A API grava antes de responder: sem registro, o dado
--   não sai. A busca de clientes não entra: ela devolve o CPF mascarado e sem telefone.
-- * O registro só recebe inclusões: o banco recusa alterar, apagar ou esvaziar a tabela (auditoria não se corrige).
--   Por isso também não há "on delete cascade": um cliente com acessos registrados não é apagado por engano.

create table public.acessos_dados_pessoais (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfis(id),
  cliente_id uuid not null references public.clientes(id),
  tela text not null check (tela in ('ficha', 'orcamento')),
  lote_id uuid references public.lotes(id),
  criado_em timestamptz not null default now()
);
create index acessos_cliente_idx on public.acessos_dados_pessoais (cliente_id, criado_em);
create index acessos_perfil_idx on public.acessos_dados_pessoais (perfil_id, criado_em);

create function public.acessos_somente_inclusao() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'O registro de acessos a dados pessoais não pode ser alterado nem apagado.';
end
$$;

create trigger acessos_sem_alterar_nem_apagar
  before update or delete on public.acessos_dados_pessoais
  for each row execute function public.acessos_somente_inclusao();
create trigger acessos_sem_esvaziar
  before truncate on public.acessos_dados_pessoais
  for each statement execute function public.acessos_somente_inclusao();

-- Mesmo desenho de segurança das outras tabelas: só a API (pela conexão do Hyperdrive) lê e grava.
alter table public.acessos_dados_pessoais enable row level security;
revoke all on public.acessos_dados_pessoais from anon, authenticated;
revoke all on function public.acessos_somente_inclusao() from public, anon, authenticated;
