-- Lotes só para a medição de tempo (scripts/medir.mjs). Cada um dá ~8 conclusões de etapa.
insert into public.lotes (tipo, descricao, quantidade, prioridade, data_entrega, bordado, etapa)
select 'Cliente', 'MEDIÇÃO ' || g, 20, 'Normal', (now() at time zone 'America/Fortaleza')::date + 10, true, 'Design'
  from generate_series(1, 10) as g;

-- Depois de medir, apague tudo (o histórico some junto, por cascata):
-- delete from public.lotes where descricao like 'MEDIÇÃO %';
