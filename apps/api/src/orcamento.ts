import { saldoCentavos, veDadosPessoais, veValores, type ItemDoOrcamento, type OrcamentoDoPedido, type Perfil, nomesDosAdicionais } from '@pcp/shared';
import type { Db } from './db';
import type { Falha } from './lote';

interface LoteLinha {
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  dataEntrega: string;
  prioridade: string;
  bordado: boolean;
  totalCentavos: number;
  criadoEm: string;
  cNome: string | null;
  cDocumento: string | null;
  cTelefone: string | null;
  cCidade: string | null;
}

interface ItemLinha {
  produto: string;
  malha: string | null;
  modo: 'adulto' | 'infantil';
  grade: Record<string, number>;
  quantidade: number;
  adicionais: { patch?: boolean; punho?: boolean; golaV?: boolean };
  precoUnitarioCentavos: number;
  adicionaisUnitarioCentavos: number;
  subtotalCentavos: number;
}

/**
 * RF-15 a RF-17: os dados do orçamento de um pedido de Cliente (o preço de cada item é o que foi gravado no dia do pedido).
 * Atendimento, direção e admin: o orçamento mostra valores e os dados do cliente, que o setor nunca vê.
 */
export async function obterOrcamento(db: Db, perfil: Perfil, loteId: string): Promise<{ ok: true; orcamento: OrcamentoDoPedido } | Falha> {
  if (!veValores(perfil) || !veDadosPessoais(perfil)) {
    return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };
  }
  const [l] = await db.query<LoteLinha>(
    `select l.numero::integer as numero, l.tipo, l.descricao, l.data_entrega::text as "dataEntrega", l.prioridade, l.bordado,
            l.total_centavos as "totalCentavos",
            (l.criado_em at time zone 'America/Fortaleza')::date::text as "criadoEm",
            c.nome as "cNome", c.documento as "cDocumento", c.telefone as "cTelefone", c.cidade as "cCidade"
       from lotes l left join clientes c on c.id = l.cliente_id
      where l.id = $1`,
    [loteId],
  );
  if (!l) return { ok: false, status: 404, erro: 'Pedido não encontrado.' };
  if (l.tipo !== 'Cliente') return { ok: false, status: 400, erro: 'Pedido de feira não tem orçamento.' };

  const linhas = await db.query<ItemLinha>(
    `select produto, malha, modo, grade, quantidade, adicionais,
            preco_unitario_centavos as "precoUnitarioCentavos", adicionais_unitario_centavos as "adicionaisUnitarioCentavos",
            subtotal_centavos as "subtotalCentavos"
       from itens_pedido where lote_id = $1 order by ordem`,
    [loteId],
  );
  const recebimentos = await db.query<{ valorCentavos: number; forma: string; dia: string }>(
    `select valor_centavos as "valorCentavos", forma, (criado_em at time zone 'America/Fortaleza')::date::text as dia
       from recebimentos where lote_id = $1 order by criado_em, id`,
    [loteId],
  );

  const itens: ItemDoOrcamento[] = linhas.map((i) => ({
    produto: i.produto,
    malha: i.malha,
    modo: i.modo,
    grade: i.grade,
    quantidade: i.quantidade,
    adicionais: nomesDosAdicionais(i.adicionais),
    unitarioCentavos: i.precoUnitarioCentavos + i.adicionaisUnitarioCentavos,
    subtotalCentavos: i.subtotalCentavos,
  }));
  const recebido = recebimentos.reduce((soma, r) => soma + r.valorCentavos, 0);

  return {
    ok: true,
    orcamento: {
      numero: Number(l.numero),
      tipo: l.tipo,
      descricao: l.descricao,
      cliente: l.cNome ? { nome: l.cNome, documento: l.cDocumento, telefone: l.cTelefone, cidade: l.cCidade } : null,
      criadoEm: l.criadoEm,
      dataEntrega: l.dataEntrega,
      prioridade: l.prioridade,
      bordado: l.bordado,
      itens,
      pecas: itens.reduce((soma, i) => soma + i.quantidade, 0),
      totalCentavos: l.totalCentavos,
      recebimentos,
      recebidoCentavos: recebido,
      saldoCentavos: saldoCentavos(l.totalCentavos, recebido),
    },
  };
}
