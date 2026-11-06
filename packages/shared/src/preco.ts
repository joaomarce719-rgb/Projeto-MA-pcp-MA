/** Valores em centavos, para não acumular erro de arredondamento. */
export const ADICIONAIS_CENTAVOS = { patch: 700, punho: 500, golaV: 200 } as const;
export type Adicional = keyof typeof ADICIONAIS_CENTAVOS;

export interface ItemPreco {
  /** Peças do produto (soma da grade). */
  quantidade: number;
  /** Preço por peça para 10 peças ou mais, em centavos. */
  maiorCentavos: number;
  /** Preço por peça para menos de 10 peças, em centavos. */
  menorCentavos: number;
  adicionais: Partial<Record<Adicional, boolean>>;
}

/** RN-07 e RN-08: a faixa é contada por produto. */
export function precoBaseCentavos(item: Pick<ItemPreco, 'quantidade' | 'maiorCentavos' | 'menorCentavos'>): number {
  return item.quantidade >= 10 ? item.maiorCentavos : item.menorCentavos;
}

/** RN-09: adicionais somam ao unitário de todas as peças do produto. */
export function unitarioCentavos(item: ItemPreco): number {
  const extra = (Object.keys(ADICIONAIS_CENTAVOS) as Adicional[]).reduce(
    (soma, k) => soma + (item.adicionais[k] ? ADICIONAIS_CENTAVOS[k] : 0),
    0,
  );
  return precoBaseCentavos(item) + extra;
}

/** RN-10: subtotal = peças × (preço da faixa + adicionais). */
export function subtotalCentavos(item: ItemPreco): number {
  return item.quantidade * unitarioCentavos(item);
}

export function totalCentavos(itens: ItemPreco[]): number {
  return itens.reduce((soma, i) => soma + subtotalCentavos(i), 0);
}

export function saldoCentavos(totalPedido: number, recebido: number): number {
  return Math.max(0, totalPedido - recebido);
}

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * RN-27: lê valores no formato brasileiro.
 * "1.500" e "1.500,00" valem mil e quinhentos; "1500,5" vale 1500,50.
 * Devolve centavos, ou null quando o texto não dá para entender.
 */
export function lerValorEmCentavos(texto: string): number | null {
  let s = texto.replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
