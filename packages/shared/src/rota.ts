export const SETORES = [
  'Design',
  'Impressão',
  'Batida',
  'Laser',
  'Conferência',
  'Bordado',
  'Costura',
  'Embalagem',
] as const;

export type Setor = (typeof SETORES)[number];
export type Etapa = Setor | 'Financeiro' | 'Concluído';
export type TipoPedido = 'Cliente' | 'Feira';

export const MAQUINAS = ['02', '03', '04'] as const;
export type Maquina = (typeof MAQUINAS)[number];

/** RN-23: só estas etapas devolvem o pedido ao Design. */
export const ETAPAS_QUE_DEVOLVEM: readonly string[] = ['Laser', 'Conferência'];

export interface LoteRota {
  etapa: Etapa;
  tipo: TipoPedido;
  bordado: boolean;
  recuperacaoPendente: boolean;
}

export function ehSetor(etapa: string): etapa is Setor {
  return (SETORES as readonly string[]).includes(etapa);
}

/** RN-16 a RN-18 e RN-23: próxima etapa depois de concluir a etapa atual. */
export function proximaEtapa(lote: LoteRota): Etapa {
  const { etapa } = lote;
  if (!ehSetor(etapa)) throw new Error(`Etapa fora da produção: ${etapa}`);
  if (etapa === 'Design' && lote.recuperacaoPendente) return 'Impressão';
  if (etapa === 'Embalagem') return lote.tipo === 'Cliente' ? 'Financeiro' : 'Concluído';
  const rota = SETORES.filter((s) => s !== 'Bordado' || lote.bordado);
  const i = rota.indexOf(etapa);
  const prox = rota[i + 1];
  if (!prox) throw new Error(`Sem próxima etapa depois de ${etapa}`);
  return prox;
}

/** A rota inteira do pedido, da Design até Concluído: sem Bordado quando não há bordado; Financeiro só para Cliente. */
export function rotaDoPedido(pedido: { tipo: TipoPedido; bordado: boolean }): Etapa[] {
  const producao = SETORES.filter((s) => s !== 'Bordado' || pedido.bordado);
  return [...producao, ...(pedido.tipo === 'Cliente' ? (['Financeiro'] as const) : []), 'Concluído'];
}

/**
 * RF-07: quantas etapas o pedido já passou e quantas tem no total (sem contar "Concluído").
 * Pedido devolvido ao Design mostra a etapa em que está agora; o histórico das voltas não entra na conta.
 */
export function progressoDoPedido(pedido: { etapa: string; tipo: TipoPedido; bordado: boolean }): { feitas: number; total: number } {
  const rota = rotaDoPedido(pedido);
  const total = rota.length - 1;
  if (pedido.etapa === 'Concluído') return { feitas: total, total };
  const i = (rota as readonly string[]).indexOf(pedido.etapa);
  return { feitas: Math.max(0, i), total };
}

export interface DadosConclusao {
  maquina?: string | undefined;
  pecas?: number | undefined;
}

/** RN-20 e RN-21: o que cada setor precisa informar para concluir. Devolve a mensagem de erro, ou null. */
export function erroDeConclusao(etapa: Setor, dados: DadosConclusao): string | null {
  if (etapa === 'Impressão' && !(MAQUINAS as readonly string[]).includes(dados.maquina ?? '')) {
    return 'Escolha a máquina usada na impressão (02, 03 ou 04).';
  }
  if (etapa === 'Embalagem' && !(Number.isInteger(dados.pecas) && (dados.pecas ?? 0) >= 1)) {
    return 'Informe a quantidade final de peças.';
  }
  return null;
}
