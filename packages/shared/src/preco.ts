/** Valores em centavos, para não acumular erro de arredondamento. */
export const ADICIONAIS_CENTAVOS = { patch: 700, punho: 500, golaV: 200 } as const;
export type Adicional = keyof typeof ADICIONAIS_CENTAVOS;

/** RN-07 e RN-08: a partir de `aPartirDe` peças do produto, o preço por peça é `centavos`. */
export interface FaixaDePreco {
  aPartirDe: number;
  centavos: number;
}

export interface ItemPreco {
  /** Peças do produto (soma da grade). */
  quantidade: number;
  /** As faixas de preço do produto, da menor quantidade para a maior; a primeira começa em 1. */
  faixas: FaixaDePreco[];
  adicionais: Partial<Record<Adicional, boolean>>;
}

/** RN-07 e RN-08: o preço por peça é o da maior faixa que a quantidade alcança (a faixa é contada por produto). */
export function precoDaFaixa(faixas: FaixaDePreco[], quantidade: number): number {
  let preco = faixas[0]?.centavos ?? 0;
  for (const f of faixas) if (quantidade >= f.aPartirDe) preco = f.centavos;
  return preco;
}

/** A primeira faixa adiante com preço menor que o atual (para avisar "com N peças o preço cai"), ou null. */
export function proximaFaixa(faixas: FaixaDePreco[], quantidade: number): FaixaDePreco | null {
  const atual = precoDaFaixa(faixas, quantidade);
  return faixas.find((f) => f.aPartirDe > quantidade && f.centavos < atual) ?? null;
}

/** "1 a 9 peças", "10 a 19 peças", "20 peças ou mais"; com uma faixa só, "Preço único". */
export function rotuloDaFaixa(faixas: FaixaDePreco[], i: number): string {
  const f = faixas[i]!;
  const seguinte = faixas[i + 1];
  if (faixas.length === 1) return 'Preço único';
  if (!seguinte) return `${f.aPartirDe} peças ou mais`;
  const ate = seguinte.aPartirDe - 1;
  return ate === f.aPartirDe ? `${f.aPartirDe} ${f.aPartirDe === 1 ? 'peça' : 'peças'}` : `${f.aPartirDe} a ${ate} peças`;
}

export function precoBaseCentavos(item: Pick<ItemPreco, 'quantidade' | 'faixas'>): number {
  return precoDaFaixa(item.faixas, item.quantidade);
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
