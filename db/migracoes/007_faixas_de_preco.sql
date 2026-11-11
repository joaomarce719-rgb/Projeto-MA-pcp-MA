-- Migração 007 · Faixas de preço por produto (RN-07 e RN-08: a quantidade que muda o preço deixa de ser fixa em 10).
-- Roda uma vez no SQL Editor do Supabase, depois da 006. Só acrescenta; nenhum preço muda.
--
-- * produtos.faixas: a lista de faixas do produto, da menor quantidade para a maior, cada uma com "a partir de quantas
--   peças" e o preço por peça em centavos: [{"aPartirDe": 1, "centavos": 4200}, {"aPartirDe": 10, "centavos": 3800}].
--   Uma faixa só = preço único. A API confere as regras (começa em 1, quantidades crescentes, preço que não sobe).
-- * Os produtos atuais viram as duas faixas de hoje: a partir de 1 (preço de menos de 10) e a partir de 10 (preço de 10
--   ou mais); se os dois preços são iguais, uma faixa só.
-- * preco_menor_centavos e preco_maior_centavos continuam e a API segue gravando (a primeira e a última faixa): a versão
--   anterior da API continua LENDO preços durante a publicação e dá para voltar atrás. Ela NÃO grava faixas: criar
--   produto por ela falha e alterar preço por ela se perde. Publique a API logo depois desta migração e não mexa na aba
--   Preços nesse intervalo.

alter table public.produtos add column faixas jsonb;

update public.produtos
   set faixas = case
     when preco_menor_centavos = preco_maior_centavos
       then jsonb_build_array(jsonb_build_object('aPartirDe', 1, 'centavos', preco_menor_centavos))
     else jsonb_build_array(
       jsonb_build_object('aPartirDe', 1, 'centavos', preco_menor_centavos),
       jsonb_build_object('aPartirDe', 10, 'centavos', preco_maior_centavos))
   end;

alter table public.produtos
  alter column faixas set not null,
  add constraint faixas_e_lista check (jsonb_typeof(faixas) = 'array' and jsonb_array_length(faixas) between 1 and 5);
