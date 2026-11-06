import { podeGerenciarPrecos, type Perfil, type ProdutoBody, type ProdutoDePreco } from '@pcp/shared';
import { ehRepetido, type Db } from './db';
import type { Falha } from './lote';

const SEM_PERMISSAO: Falha = {
  ok: false,
  status: 403,
  erro: 'Esta área não faz parte do seu perfil. Peça ao Administrador a permissão de gerenciar preços.',
};

const NOME_REPETIDO = (nome: string): Falha => ({ ok: false, status: 409, erro: `Já existe um produto chamado ${nome}.` });


/** RN-11: todos os produtos, ativos e desativados, com os dois preços por peça e quem alterou por último. */
export async function listarPrecos(db: Db, perfil: Perfil): Promise<{ ok: true; produtos: ProdutoDePreco[] } | Falha> {
  if (!podeGerenciarPrecos(perfil)) return SEM_PERMISSAO;
  const produtos = await db.query<ProdutoDePreco>(
    `select p.id, p.nome, p.malha, p.preco_maior_centavos as "maiorCentavos", p.preco_menor_centavos as "menorCentavos",
            p.ativo, p.atualizado_em as "atualizadoEm", u.nome as "atualizadoPor"
       from produtos p left join perfis u on u.id = p.atualizado_por
      order by p.ativo desc, p.nome`,
  );
  return { ok: true, produtos };
}

/** RN-11: cria um produto. O preço dos pedidos já feitos não muda: cada item guarda o preço do dia. */
export async function criarProduto(db: Db, perfil: Perfil, body: ProdutoBody): Promise<{ ok: true; id: string } | Falha> {
  if (!podeGerenciarPrecos(perfil)) return SEM_PERMISSAO;
  const [igual] = await db.query('select 1 as ok from produtos where nome = $1', [body.nome]);
  if (igual) return NOME_REPETIDO(body.nome);
  try {
    const [novo] = await db.query<{ id: string }>(
      `insert into produtos (nome, malha, preco_maior_centavos, preco_menor_centavos, ativo, atualizado_por)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [body.nome, body.malha, body.maiorCentavos, body.menorCentavos, body.ativo, perfil.id],
    );
    return { ok: true, id: novo!.id };
  } catch (erro) {
    if (ehRepetido(erro)) return NOME_REPETIDO(body.nome); // duas pessoas criando o mesmo produto ao mesmo tempo
    throw erro;
  }
}

/** RN-11: altera nome, malha, preços e se o produto está ativo. Desativar não apaga: o produto só deixa de aparecer no pedido novo. */
export async function atualizarProduto(db: Db, perfil: Perfil, id: string, body: ProdutoBody): Promise<{ ok: true } | Falha> {
  if (!podeGerenciarPrecos(perfil)) return SEM_PERMISSAO;
  const [existe] = await db.query('select 1 as ok from produtos where id = $1', [id]);
  if (!existe) return { ok: false, status: 404, erro: 'Produto não encontrado.' };
  const [igual] = await db.query('select 1 as ok from produtos where nome = $1 and id <> $2', [body.nome, id]);
  if (igual) return NOME_REPETIDO(body.nome);
  try {
    await db.query(
      `update produtos set nome = $2, malha = $3, preco_maior_centavos = $4, preco_menor_centavos = $5, ativo = $6,
              atualizado_por = $7, atualizado_em = now()
        where id = $1`,
      [id, body.nome, body.malha, body.maiorCentavos, body.menorCentavos, body.ativo, perfil.id],
    );
  } catch (erro) {
    if (ehRepetido(erro)) return NOME_REPETIDO(body.nome);
    throw erro;
  }
  return { ok: true };
}
