import { diaEmFortaleza, montarQuadro, veQuadro, type LoteDoQuadro, type Perfil, type QuadroResposta } from '@pcp/shared';
import type { Db } from './db';
import { resumoFinanceiro } from './financeiro';
import type { Falha } from './lote';

/**
 * RF-29 a RF-32: quadro da Direção, só leitura. Só direção e admin.
 * Lê os pedidos em aberto e os concluídos hoje (horário de Fortaleza); a montagem das colunas e dos indicadores é a regra
 * de `packages/shared/src/quadro.ts`, a mesma que os testes cobrem.
 */
export async function obterQuadro(db: Db, perfil: Perfil): Promise<{ ok: true; quadro: QuadroResposta } | Falha> {
  if (!veQuadro(perfil)) {
    return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };
  }
  const hoje = diaEmFortaleza();

  const lotes = await db.query<LoteDoQuadro>(
    `select l.id, l.numero::integer as numero, l.tipo, l.descricao, l.quantidade, l.prioridade,
            l.data_entrega::text as "dataEntrega", l.etapa, l.recuperacao_pendente as "recuperacaoPendente",
            case when l.recuperacao_pendente then
              (select h.etapa from historico h where h.lote_id = l.id and h.tipo = 'Recuperação' order by h.id desc limit 1)
            end as "devolvidoPor",
            case when l.recuperacao_pendente then
              (select h.nota from historico h where h.lote_id = l.id and h.tipo = 'Recuperação' order by h.id desc limit 1)
            end as "motivoRecuperacao"
       from lotes l
      where l.etapa <> 'Concluído'
         or (l.finalizado_em at time zone 'America/Fortaleza')::date = $1::text::date`,
    [hoje],
  );

  // RN-36: peças finalizadas no dia = soma das quantidades finais informadas pela Embalagem naquele dia.
  const [finalizadas] = await db.query<{ pecas: number }>(
    `select coalesce(sum(pecas), 0)::int as pecas
       from historico
      where etapa = 'Embalagem' and tipo = 'Conclusão'
        and (criado_em at time zone 'America/Fortaleza')::date = $1::text::date`,
    [hoje],
  );
  const dinheiro = await resumoFinanceiro(db, hoje);

  return {
    ok: true,
    quadro: montarQuadro({
      lotes: lotes.map((l) => ({ ...l, numero: Number(l.numero) })),
      hoje,
      agora: new Date().toISOString(),
      pecasFinalizadasHoje: finalizadas?.pecas ?? 0,
      aReceberCentavos: dinheiro.aReceberCentavos,
      recebidoMesCentavos: dinheiro.recebidoMesCentavos,
    }),
  };
}
