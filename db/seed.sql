-- Dados de teste da prova de conceito. Rode depois de schema.sql.

insert into public.lotes (tipo, descricao, quantidade, prioridade, data_entrega, bordado, etapa) values
  ('Cliente', 'Escola Modelo Aurora · camisas infantis', 56, 'Urgente', (now() at time zone 'America/Fortaleza')::date + 2, true,  'Impressão'),
  ('Cliente', 'Clube Atlético Exemplo · treino',           24, 'Alta',    (now() at time zone 'America/Fortaleza')::date + 3, false, 'Batida'),
  ('Feira',   'Feira do Centro · camisas dry fit',          46, 'Normal',  (now() at time zone 'America/Fortaleza')::date + 7, false, 'Costura'),
  ('Cliente', 'Liga Simulada de Futsal · patch',            34, 'Alta',    (now() at time zone 'America/Fortaleza')::date,     true,  'Embalagem'),
  ('Cliente', 'Academia Demo Fit · regatas',                16, 'Normal',  (now() at time zone 'America/Fortaleza')::date + 5, false, 'Design');

-- Perfis: crie primeiro cada usuário em Authentication > Users (e-mail + senha) e depois rode, trocando os e-mails:
--
-- insert into public.perfis (id, nome, email, papel)        select id, 'Atendimento (teste)', email, 'atendimento' from auth.users where email = 'atendimento@teste.com';
-- insert into public.perfis (id, nome, email, papel, setor) select id, 'Maria', email, 'setor', 'Impressão' from auth.users where email = 'impressao@teste.com';
-- insert into public.perfis (id, nome, email, papel)        select id, 'Direção (teste)', email, 'direcao' from auth.users where email = 'direcao@teste.com';
-- O primeiro administrador entra por aqui; os demais usuários o administrador cria pela tela "Usuários".
-- insert into public.perfis (id, nome, email, papel)        select id, 'Administrador', email, 'admin' from auth.users where email = 'admin@teste.com';
