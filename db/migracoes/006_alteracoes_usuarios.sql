-- Migração 006 · Registro de alterações de usuários (RF-04: editar nome, papel e setor de quem já existe).
-- Roda uma vez no SQL Editor do Supabase, depois da 005. Só acrescenta; não apaga nem altera dados.
--
-- * alteracoes_usuarios: uma linha por edição que mudou alguma coisa, com quem foi alterado, quem alterou, quando e os
--   valores de antes e depois (só os campos que mudaram: nome, papel, setor, gerenciaPrecos).
-- * O registro só recebe inclusões: o banco recusa alterar, apagar ou esvaziar a tabela (auditoria não se corrige).
--   Sem "on delete cascade": um usuário com alterações registradas não é apagado (usuário se desativa).

create table public.alteracoes_usuarios (
  id bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfis(id),
  alterado_por uuid not null references public.perfis(id),
  antes jsonb not null,
  depois jsonb not null,
  criado_em timestamptz not null default now()
);
create index alteracoes_usuarios_perfil_idx on public.alteracoes_usuarios (perfil_id, criado_em);

create function public.alteracoes_usuarios_somente_inclusao() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'O registro de alterações de usuários não pode ser alterado nem apagado.';
end
$$;

create trigger alteracoes_usuarios_sem_alterar_nem_apagar
  before update or delete on public.alteracoes_usuarios
  for each row execute function public.alteracoes_usuarios_somente_inclusao();
create trigger alteracoes_usuarios_sem_esvaziar
  before truncate on public.alteracoes_usuarios
  for each statement execute function public.alteracoes_usuarios_somente_inclusao();

-- Mesmo desenho de segurança das outras tabelas: só a API (pela conexão do Hyperdrive) lê e grava.
alter table public.alteracoes_usuarios enable row level security;
revoke all on public.alteracoes_usuarios from anon, authenticated;
revoke all on function public.alteracoes_usuarios_somente_inclusao() from public, anon, authenticated;
