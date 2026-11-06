import { ETAPAS_QUE_DEVOLVEM, type DevolverBody, type Perfil } from '@pcp/shared';
import type { Db } from './db';
import { CONFLITO, carregarParaMover, type Falha } from './lote';

export type ResultadoDevolucao = { ok: true; versao: number } | Falha;

/**
 * RN-23: devolve o pedido ao Design, com motivo. O pedido fica marcado como Recuperação até o Design concluir
 * (aí ele segue para a Impressão). Mesma transação, mesma checagem de etapa e versão de `concluir`.
 */
export async function devolverLote(
  db: Db,
  perfil: Perfil,
  loteId: string,
  body: DevolverBody,
): Promise<ResultadoDevolucao> {
  return db.transaction(async (tx): Promise<ResultadoDevolucao> => {
    const carregado = await carregarParaMover(tx, perfil, loteId, body.versao, 'devolver');
    if (!carregado.ok) return carregado;
    const { lote } = carregado;

    if (!ETAPAS_QUE_DEVOLVEM.includes(lote.etapa)) {
      return { ok: false, status: 403, erro: 'Só o Laser e a Conferência podem devolver um pedido ao Design.' };
    }

    const atualizado = await tx.query<{ versao: number }>(
      `update lotes
          set etapa = 'Design',
              recuperacao_pendente = true,
              recuperacoes = recuperacoes + 1,
              versao = versao + 1,
              atualizado_em = now()
        where id = $1 and etapa = $2 and versao = $3
        returning versao`,
      [lote.id, lote.etapa, lote.versao],
    );
    const novo = atualizado[0];
    if (!novo) return { ok: false, status: 409, erro: CONFLITO };

    // A etapa do histórico é quem devolveu (Laser ou Conferência); o motivo vai na observação.
    await tx.query(
      `insert into historico (lote_id, etapa, tipo, nota, usuario_id)
       values ($1, $2, 'Recuperação', $3, $4)`,
      [lote.id, lote.etapa, body.motivo, perfil.id],
    );

    return { ok: true, versao: novo.versao };
  });
}
