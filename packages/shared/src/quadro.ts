import { estaAtrasado } from './prazo';
import { SETORES, ehSetor } from './rota';

/** Prioridade para ordenar (RN-35): Urgente, Alta, Normal. */
const PESO_PRIORIDADE: Record<string, number> = { Urgente: 0, Alta: 1, Normal: 2 };

/** RN-35: prioridade, depois a data de entrega mais próxima, depois o número. */
export function compararFila(
  a: { prioridade: string; dataEntrega: string; numero: number },
  b: { prioridade: string; dataEntrega: string; numero: number },
): number {
  return (
    (PESO_PRIORIDADE[a.prioridade] ?? 2) - (PESO_PRIORIDADE[b.prioridade] ?? 2) ||
    a.dataEntrega.localeCompare(b.dataEntrega) ||
    a.numero - b.numero
  );
}

/** O que a API entrega, por pedido, para montar o quadro. */
export interface LoteDoQuadro {
  id: string;
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  quantidade: number;
  prioridade: 'Urgente' | 'Alta' | 'Normal';
  dataEntrega: string;
  etapa: string;
  recuperacaoPendente: boolean;
  /** Setor que devolveu ao Design e o motivo; só quando o pedido está em recuperação. */
  devolvidoPor: string | null;
  motivoRecuperacao: string | null;
}

export interface CartaoDoQuadro {
  id: string;
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  prioridade: 'Urgente' | 'Alta' | 'Normal';
  dataEntrega: string;
  pecas: number;
  recuperacaoPendente: boolean;
}

export interface ColunaDoQuadro {
  /** Nome do setor, "Financeiro" ou "Concluídos hoje". */
  chave: string;
  nome: string;
  pedidos: CartaoDoQuadro[];
  pecas: number;
}

export interface AtencaoDoQuadro {
  tipo: 'atraso' | 'recuperacao';
  id: string;
  numero: number;
  descricao: string;
  etapa: string;
  prioridade: string;
  dataEntrega: string;
  devolvidoPor: string | null;
  motivo: string | null;
}

export interface QuadroResposta {
  /** Quando o quadro foi montado (ISO), para mostrar "atualizado às…". */
  geradoEm: string;
  emProducaoPedidos: number;
  emProducaoPecas: number;
  atrasados: number;
  urgentes: number;
  pecasFinalizadasHoje: number;
  aReceberCentavos: number;
  recebidoMesCentavos: number;
  colunas: ColunaDoQuadro[];
  atencao: AtencaoDoQuadro[];
}

export interface EntradaDoQuadro {
  /** Pedidos em aberto e os concluídos hoje (o que a API lê do banco). */
  lotes: LoteDoQuadro[];
  hoje: string;
  agora: string;
  /** RN-36: soma das peças informadas pela Embalagem hoje, de Cliente e de Feira. */
  pecasFinalizadasHoje: number;
  aReceberCentavos: number;
  recebidoMesCentavos: number;
}

const cartao = (l: LoteDoQuadro): CartaoDoQuadro => ({
  id: l.id,
  numero: l.numero,
  tipo: l.tipo,
  descricao: l.descricao,
  prioridade: l.prioridade,
  dataEntrega: l.dataEntrega,
  pecas: l.quantidade,
  recuperacaoPendente: l.recuperacaoPendente,
});

const somaDePecas = (lista: CartaoDoQuadro[]) => lista.reduce((soma, c) => soma + c.pecas, 0);

/**
 * RF-29 a RF-32: monta o quadro da Direção a partir dos pedidos.
 * Uma coluna por setor, mais Financeiro e entrega e Concluídos hoje; os indicadores contam só o que está em aberto;
 * "Atenção" lista os atrasados e os pedidos em recuperação (um pedido atrasado e em recuperação aparece nas duas).
 */
export function montarQuadro(entrada: EntradaDoQuadro): QuadroResposta {
  const { lotes, hoje } = entrada;
  const abertos = lotes.filter((l) => l.etapa !== 'Concluído').sort(compararFila);
  const emProducao = abertos.filter((l) => ehSetor(l.etapa));
  const atrasados = abertos.filter((l) => estaAtrasado(l.dataEntrega, hoje));

  const coluna = (chave: string, nome: string, doGrupo: LoteDoQuadro[]): ColunaDoQuadro => {
    const pedidos = doGrupo.map(cartao);
    return { chave, nome, pedidos, pecas: somaDePecas(pedidos) };
  };
  const colunas = [
    ...SETORES.map((s) => coluna(s, s, abertos.filter((l) => l.etapa === s))),
    coluna('Financeiro', 'Financeiro e entrega', abertos.filter((l) => l.etapa === 'Financeiro')),
    coluna('Concluído', 'Concluídos hoje', lotes.filter((l) => l.etapa === 'Concluído').sort(compararFila)),
  ];

  const atencao: AtencaoDoQuadro[] = [
    ...atrasados.map((l) => ({ ...l, tipo: 'atraso' as const })),
    ...abertos.filter((l) => l.recuperacaoPendente).map((l) => ({ ...l, tipo: 'recuperacao' as const })),
  ].map((l) => ({
    tipo: l.tipo,
    id: l.id,
    numero: l.numero,
    descricao: l.descricao,
    etapa: l.etapa,
    prioridade: l.prioridade,
    dataEntrega: l.dataEntrega,
    devolvidoPor: l.devolvidoPor,
    motivo: l.motivoRecuperacao,
  }));

  return {
    geradoEm: entrada.agora,
    emProducaoPedidos: emProducao.length,
    emProducaoPecas: emProducao.reduce((soma, l) => soma + l.quantidade, 0),
    atrasados: atrasados.length,
    urgentes: abertos.filter((l) => l.prioridade === 'Urgente').length,
    pecasFinalizadasHoje: entrada.pecasFinalizadasHoje,
    aReceberCentavos: entrada.aReceberCentavos,
    recebidoMesCentavos: entrada.recebidoMesCentavos,
    colunas,
    atencao,
  };
}
