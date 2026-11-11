import { veValores, type Perfil, type ProdutoDoCatalogo } from '@pcp/shared';
import type { Db } from './db';
import type { Falha } from './lote';

/**
 * RF-10: o catálogo de produtos e preços para montar o pedido. Os preços vão para atendimento, direção e admin:
 * o setor nunca vê valores (RF-02).
 */
export async function listarCatalogo(db: Db, perfil: Perfil): Promise<{ ok: true; produtos: ProdutoDoCatalogo[] } | Falha> {
  if (!veValores(perfil)) {
    return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };
  }
  const produtos = await db.query<ProdutoDoCatalogo>(
    `select id, nome, malha, faixas
       from produtos where ativo order by nome`,
  );
  return { ok: true, produtos };
}
