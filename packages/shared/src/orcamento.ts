import type { Adicionais, Grade, ModoGrade } from './pedido';
import { TAMANHOS } from './pedido';
import { ADICIONAIS_CENTAVOS, formatarReais, subtotalCentavos, unitarioCentavos, precoBaseCentavos, type ItemPreco } from './preco';

/** Produtos de calção, bermuda ou calça: a malha do calção do pedido vem deles (RF-20), não é escolhida à parte. */
const PRODUTO_DE_CALCAO = /^(CALÇÃO|BERMUDA|CALÇA)/;

export const ehProdutoDeCalcao = (nome: string) => PRODUTO_DE_CALCAO.test(nome);

/** "Não se aplica" quando o pedido não tem calção; senão as malhas dos calções, sem repetir. */
export function malhaDoCalcao(itens: { produto: string; malha?: string | null }[]): string {
  const malhas = itens
    .filter((i) => ehProdutoDeCalcao(i.produto) && i.malha)
    .map((i) => i.malha as string)
    .filter((m, k, todas) => todas.indexOf(m) === k);
  return malhas.length ? malhas.map(tituloDoProduto).join(' / ') : 'Não se aplica';
}

/** O catálogo guarda os nomes em maiúsculas (como no sistema atual); na tela e no orçamento saem com iniciais maiúsculas. */
export function tituloDoProduto(texto: string): string {
  const pequenas = new Set(['de', 'da', 'do', 'e', 'em', 'c']);
  return texto
    .toLowerCase()
    .split(' ')
    .map((palavra, i) => {
      if (/\d/.test(palavra)) return palavra.toUpperCase();
      if (palavra === 'c/') return 'c/';
      if (i > 0 && pequenas.has(palavra)) return palavra;
      return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    })
    .join(' ');
}

/** Produtos infantis usam a grade infantil (2 a 14); os demais, a adulta. */
export const modoDoProduto = (nome: string): ModoGrade => (/INFANTIL/.test(nome.toUpperCase()) ? 'infantil' : 'adulto');

/** A faixa de preço (RN-07 e RN-08, contada por produto — D6): 10 peças ou mais pagam o preço menor por peça. */
export const FAIXA_DE_PECAS = 10;

export interface ItemPrecificado {
  quantidade: number;
  /** Preço base por peça na faixa do produto, sem os adicionais. */
  precoUnitarioCentavos: number;
  /** Soma dos adicionais por peça (patch, punho, gola V). */
  adicionaisUnitarioCentavos: number;
  subtotalCentavos: number;
}

/** RN-09 e RN-10: subtotal = peças × (preço da faixa + adicionais). Tudo em centavos inteiros. */
export function precificarItem(item: ItemPreco): ItemPrecificado {
  const base = precoBaseCentavos(item);
  return {
    quantidade: item.quantidade,
    precoUnitarioCentavos: base,
    adicionaisUnitarioCentavos: unitarioCentavos(item) - base,
    subtotalCentavos: subtotalCentavos(item),
  };
}

export const NOME_DO_ADICIONAL: Record<keyof Adicionais, string> = { patch: 'Patch', punho: 'Punho', golaV: 'Gola V' };

export const nomesDosAdicionais = (adicionais: Partial<Adicionais> | null | undefined): string[] =>
  (Object.keys(ADICIONAIS_CENTAVOS) as (keyof Adicionais)[]).filter((k) => adicionais?.[k]).map((k) => NOME_DO_ADICIONAL[k]);

/** "M 6 · G 4": só os tamanhos com peças, na ordem da grade. */
export function resumoDaGrade(modo: ModoGrade, grade: Grade): string {
  return TAMANHOS[modo]
    .filter((t) => (grade[t] ?? 0) > 0)
    .map((t) => `${t} ${grade[t]}`)
    .join(' · ');
}

export interface ItemDoOrcamento {
  produto: string;
  malha: string | null;
  modo: ModoGrade;
  grade: Grade;
  quantidade: number;
  adicionais: string[];
  /** Preço por peça já com os adicionais. */
  unitarioCentavos: number;
  subtotalCentavos: number;
}

export interface OrcamentoDoPedido {
  numero: number;
  tipo: 'Cliente' | 'Feira';
  /** Nome do cliente, ou a descrição da feira. */
  descricao: string;
  cliente: { nome: string; documento: string | null; telefone: string | null; cidade: string | null } | null;
  /** Dia em que o pedido foi aberto (AAAA-MM-DD, Fortaleza). */
  criadoEm: string;
  dataEntrega: string;
  prioridade: string;
  bordado: boolean;
  itens: ItemDoOrcamento[];
  pecas: number;
  totalCentavos: number;
  recebimentos: { valorCentavos: number; forma: string; dia: string }[];
  recebidoCentavos: number;
  saldoCentavos: number;
}

const dataBR = (dia: string) => dia.split('-').reverse().join('/');

/**
 * RF-17: a mensagem do orçamento, pronta para copiar e colar no WhatsApp. O sistema não envia nada.
 */
export function mensagemDoOrcamento(o: OrcamentoDoPedido): string {
  const linhas = [`Olá, ${o.descricao}! Segue o orçamento nº ${o.numero} da MA Fardamentos:`, ''];
  for (const i of o.itens) {
    linhas.push(`• ${i.quantidade}× ${tituloDoProduto(i.produto)} (${resumoDaGrade(i.modo, i.grade)}) — ${formatarReais(i.subtotalCentavos)}`);
  }
  linhas.push('', `Total: ${formatarReais(o.totalCentavos)}`);
  if (o.recebidoCentavos > 0) {
    linhas.push(`Entrada recebida: ${formatarReais(o.recebidoCentavos)} · Saldo: ${formatarReais(o.saldoCentavos)}`);
  }
  linhas.push(`Prazo de entrega: ${dataBR(o.dataEntrega)}`, 'Válido por 30 dias.');
  return linhas.join('\n');
}

/** Um produto do catálogo, com os preços por peça em centavos (faixa de 10 peças ou mais, e de menos de 10). */
export interface ProdutoDoCatalogo {
  id: string;
  nome: string;
  malha: string;
  maiorCentavos: number;
  menorCentavos: number;
}
