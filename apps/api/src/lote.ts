import { ehSetor, trabalhaNaEtapa, type Perfil, type Setor, type TipoPedido } from '@pcp/shared';
import type { Tx } from './db';

export interface Falha {
  ok: false;
  status: 400 | 403 | 404 | 409 | 413 | 415;
  erro: string;
}

export interface LoteLinha {
  id: string;
  numero: number;
  tipo: TipoPedido;
  etapa: Setor;
  bordado: boolean;
  recuperacao_pendente: boolean;
  versao: number;
}

export const CONFLITO = 'Este pedido foi alterado por outra pessoa. Atualize a tela e tente de novo.';

/**
 * Passo comum de mover um pedido (concluir ou devolver), dentro da transação:
 * acha o pedido, confere quem pode mexer nele e se a pessoa ainda está vendo a versão atual.
 *
 * - 404: não existe. 403: este perfil não mexe neste pedido.
 * - 409: o pedido já passou pelo setor da pessoa (clique repetido ou outro aparelho), não está mais em produção,
 *   ou a versão mudou (RNF-04).
 */
export async function carregarParaMover(
  tx: Tx,
  perfil: Perfil,
  loteId: string,
  versao: number,
  acao: string,
): Promise<{ ok: true; lote: LoteLinha } | Falha> {
  const [achado] = await tx.query<Omit<LoteLinha, 'etapa'> & { etapa: string }>(
    'select id, numero, tipo, etapa, bordado, recuperacao_pendente, versao from lotes where id = $1',
    [loteId],
  );
  if (!achado) return { ok: false, status: 404, erro: 'Pedido não encontrado.' };

  if (!trabalhaNaEtapa(perfil, achado.etapa)) {
    // Se o pedido já passou por este setor, a pessoa só chegou atrasada: 409, não 403.
    if (perfil.papel === 'setor' && perfil.setor) {
      const [jaPassou] = await tx.query('select 1 as ok from historico where lote_id = $1 and etapa = $2 limit 1', [
        achado.id,
        perfil.setor,
      ]);
      if (jaPassou) return { ok: false, status: 409, erro: CONFLITO };
    }
    return { ok: false, status: 403, erro: `Sem permissão para ${acao} este pedido.` };
  }

  if (!ehSetor(achado.etapa)) {
    return { ok: false, status: 409, erro: 'Este pedido não está em um setor de produção.' };
  }
  if (achado.versao !== versao) return { ok: false, status: 409, erro: CONFLITO };

  return { ok: true, lote: { ...achado, etapa: achado.etapa } };
}
