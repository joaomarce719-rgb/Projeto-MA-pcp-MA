import { veValores, type LoteFila, type Perfil } from '@pcp/shared';
import type { Db } from './db';
import type { Falha } from './lote';

export type Aba = 'andamento' | 'concluidos';

/** Os concluídos mais recentes; a lista não cresce para sempre na tela. */
const LIMITE_CONCLUIDOS = 50;

const COLUNAS = `l.id, l.numero::integer as numero, l.tipo, l.descricao, l.quantidade, l.prioridade,
       l.data_entrega::text as "dataEntrega", l.bordado, l.etapa, l.versao,
       l.recuperacao_pendente as "recuperacaoPendente",
       case when l.recuperacao_pendente then
         (select h.nota from historico h where h.lote_id = l.id and h.tipo = 'Recuperação' order by h.id desc limit 1)
       end as "motivoRecuperacao"`;

/** Valores do pedido (RF-07): vão para atendimento, direção e admin; o setor nunca recebe estas colunas. */
const COLUNAS_DE_VALORES = `,
       l.total_centavos as "totalCentavos",
       coalesce((select sum(r.valor_centavos) from recebimentos r where r.lote_id = l.id), 0)::int as "recebidoCentavos"`;

/**
 * RF-06 e RF-18.
 * - Em andamento: o setor vê só a própria fila; atendimento, direção e admin veem todas as etapas em aberto.
 *   Ordem: prioridade, data de entrega mais próxima, número (RN-35).
 * - Concluídos (atendimento, direção e admin): do mais recente ao mais antigo.
 * - A Direção só lê: concluir e devolver continuam bloqueados para ela (`lote.ts`).
 */
export async function listarFila(db: Db, perfil: Perfil, aba: Aba): Promise<{ ok: true; lotes: LoteFila[] } | Falha> {
  if (perfil.papel === 'setor') {
    if (aba === 'concluidos') return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };
    if (!perfil.setor) return { ok: false, status: 403, erro: 'Perfil de setor sem setor definido.' };
  }
  const colunas = veValores(perfil) ? COLUNAS + COLUNAS_DE_VALORES : COLUNAS;

  if (aba === 'concluidos') {
    const lotes = await db.query<LoteFila>(
      `select ${colunas}
         from lotes l
        where l.etapa = 'Concluído'
        order by l.finalizado_em desc nulls last, l.numero desc
        limit ${LIMITE_CONCLUIDOS}`,
    );
    return { ok: true, lotes };
  }

  const lotes = await db.query<LoteFila>(
    `select ${colunas}
       from lotes l
      where l.etapa <> 'Concluído'
        and ($1::text is null or l.etapa = $1)
      order by case l.prioridade when 'Urgente' then 0 when 'Alta' then 1 else 2 end,
               l.data_entrega, l.numero`,
    [perfil.papel === 'setor' ? perfil.setor : null],
  );
  return { ok: true, lotes };
}
