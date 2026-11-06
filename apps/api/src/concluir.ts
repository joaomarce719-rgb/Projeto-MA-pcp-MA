import { erroDeConclusao, proximaEtapa, type ConcluirBody, type Etapa, type Perfil } from '@pcp/shared';
import type { Db } from './db';
import { CONFLITO, carregarParaMover, type Falha } from './lote';

export type ResultadoConclusao = { ok: true; etapa: Etapa; versao: number } | Falha;

/**
 * RN-19 a RN-23: conclui a etapa atual do lote e grava o histórico na mesma transação.
 * A gravação só vale se o lote ainda estiver na etapa e na versão que a pessoa viu (409 se não).
 */
export async function concluirLote(
  db: Db,
  perfil: Perfil,
  loteId: string,
  body: ConcluirBody,
): Promise<ResultadoConclusao> {
  return db.transaction(async (tx): Promise<ResultadoConclusao> => {
    const carregado = await carregarParaMover(tx, perfil, loteId, body.versao, 'concluir');
    if (!carregado.ok) return carregado;
    const { lote } = carregado;

    const faltando = erroDeConclusao(lote.etapa, { maquina: body.maquina, pecas: body.pecas });
    if (faltando) return { ok: false, status: 400, erro: faltando };

    // Só grava o que a etapa exige: máquina na Impressão, peças na Embalagem (o resto é ignorado).
    const maquina = lote.etapa === 'Impressão' ? (body.maquina ?? null) : null;
    const pecas = lote.etapa === 'Embalagem' ? (body.pecas ?? null) : null;

    const destino = proximaEtapa({
      etapa: lote.etapa,
      tipo: lote.tipo,
      bordado: lote.bordado,
      recuperacaoPendente: lote.recuperacao_pendente,
    });

    const atualizado = await tx.query<{ versao: number }>(
      `update lotes
          set etapa = $2,
              versao = versao + 1,
              recuperacao_pendente = case when etapa = 'Design' then false else recuperacao_pendente end,
              entregue = case when etapa = 'Embalagem' then $5 else entregue end,
              finalizado_em = case when $2 = 'Concluído' then now() else finalizado_em end,
              atualizado_em = now()
        where id = $1 and etapa = $3 and versao = $4
        returning versao`,
      [lote.id, destino, lote.etapa, lote.versao, pecas],
    );
    const novo = atualizado[0];
    if (!novo) return { ok: false, status: 409, erro: CONFLITO };

    await tx.query(
      `insert into historico (lote_id, etapa, tipo, nota, maquina, pecas, usuario_id)
       values ($1, $2, 'Conclusão', $3, $4, $5, $6)`,
      [lote.id, lote.etapa, body.nota || null, maquina, pecas, perfil.id],
    );

    return { ok: true, etapa: destino, versao: novo.versao };
  });
}
