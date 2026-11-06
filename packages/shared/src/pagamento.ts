import { z } from 'zod';
import { tipoDaImagem } from './foto';
import { formatarReais, saldoCentavos } from './preco';

/** RN-26: formas de pagamento aceitas. Nenhuma vem marcada. */
export const FORMAS_PAGAMENTO = ['Pix', 'Dinheiro', 'Cartão', 'Boleto', 'Transferência'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

/** Teto de um valor, em centavos (R$ 1.000.000,00): barra erro de digitação e cabe em `integer` do banco. */
export const VALOR_MAXIMO_CENTAVOS = 100_000_000;

/** RN-24: a entrada sugerida é 50% do total. É só referência; o campo vem vazio. */
export function entradaSugeridaCentavos(totalCentavos: number): number {
  return Math.round(totalCentavos / 2);
}

/** Percentual do total já recebido, de 0 a 100. Pedido sem valor conta como 100% (não há o que cobrar). */
export function percentualPago(totalCentavos: number, recebidoCentavos: number): number {
  if (totalCentavos <= 0) return 100;
  return Math.min(100, Math.floor((recebidoCentavos / totalCentavos) * 100));
}

/**
 * RN-25 e RN-26: confere um recebimento. `saldo` é o que ainda falta receber (na entrada, o total do pedido).
 * Devolve a mensagem para a pessoa, ou null se está tudo certo.
 */
export function erroDoRecebimento(saldo: number, valorCentavos: number, forma: string | null | undefined): string | null {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return 'Informe um valor maior que zero.';
  if (valorCentavos > saldo) {
    return saldo <= 0
      ? 'Este pedido já está pago por inteiro.'
      : `O valor passa do saldo de ${formatarReais(saldo)}. Informe até ${formatarReais(saldo)}.`;
  }
  if (!forma || !(FORMAS_PAGAMENTO as readonly string[]).includes(forma)) return 'Escolha a forma de pagamento.';
  return null;
}

/** RN-30: a entrega só é confirmada com saldo zero. */
export function erroDaEntrega(totalCentavos: number, recebidoCentavos: number): string | null {
  const saldo = saldoCentavos(totalCentavos, recebidoCentavos);
  return saldo > 0 ? `Ainda há saldo de ${formatarReais(saldo)}. Registre o recebimento antes de confirmar a entrega.` : null;
}

export const valorEmCentavos = z
  .number({ message: 'Informe o valor.' })
  .int('Informe o valor em reais e centavos.')
  .min(1, 'Informe um valor maior que zero.')
  .max(VALOR_MAXIMO_CENTAVOS, 'O valor é alto demais. Confira o que foi digitado.');

export const entradaBody = z.object({
  valorCentavos: valorEmCentavos,
  forma: z.enum(FORMAS_PAGAMENTO, { message: 'Escolha a forma de pagamento.' }),
});
export type EntradaBody = z.infer<typeof entradaBody>;

export const recebimentoBody = z.object({
  versao: z.number().int().min(1),
  valorCentavos: valorEmCentavos,
  forma: z.enum(FORMAS_PAGAMENTO, { message: 'Escolha a forma de pagamento.' }),
});
export type RecebimentoBody = z.infer<typeof recebimentoBody>;

export const entregaBody = z.object({ versao: z.number().int().min(1) });
export type EntregaBody = z.infer<typeof entregaBody>;

/** Comprovante de recebimento: imagem (JPEG, PNG, WebP) ou PDF, até 5 MB. */
export const COMPROVANTE_TAMANHO_MAXIMO = 5 * 1024 * 1024;
export const TIPOS_DE_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type TipoDeComprovante = (typeof TIPOS_DE_COMPROVANTE)[number];

/** Descobre o tipo pelos primeiros bytes (imagem ou PDF), não pelo que o navegador declarou. */
export function tipoDoComprovante(dados: Uint8Array): TipoDeComprovante | null {
  const imagem = tipoDaImagem(dados);
  if (imagem) return imagem;
  // PDF: "%PDF-"
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => dados[i] === byte) ? 'application/pdf' : null;
}

export interface RecebimentoLinha {
  id: string;
  valorCentavos: number;
  forma: FormaPagamento;
  momento: 'Entrada' | 'Financeiro';
  por: string | null;
  em: string;
  temComprovante: boolean;
}

export interface PedidoFinanceiro {
  id: string;
  numero: number;
  descricao: string;
  versao: number;
  dataEntrega: string;
  /** Peças que a Embalagem informou ao concluir. */
  pecasEmbaladas: number | null;
  totalCentavos: number;
  recebidoCentavos: number;
  saldoCentavos: number;
  percentualPago: number;
  recebimentos: RecebimentoLinha[];
}

/** RF-25: o recebido no dia, nos últimos 7 dias e no mês, e o total a receber. */
export interface ResumoFinanceiro {
  recebidoHojeCentavos: number;
  recebido7DiasCentavos: number;
  recebidoMesCentavos: number;
  aReceberCentavos: number;
}

export interface FinanceiroResposta {
  resumo: ResumoFinanceiro;
  pedidos: PedidoFinanceiro[];
}

/** Valores de um pedido de Cliente na ficha: só atendimento, direção e admin recebem (o setor nunca). */
export interface ValoresDoPedido {
  totalCentavos: number;
  recebidoCentavos: number;
  saldoCentavos: number;
  percentualPago: number;
  recebimentos: RecebimentoLinha[];
}
