import { z } from 'zod';
import type { FaixaDePreco } from './preco';
import type { Perfil } from './schemas';

/** Maior preço aceito por peça (R$ 10.000,00): barra o erro de digitação de vírgula, como "3500,00" virar "350000". */
export const PRECO_MAXIMO_POR_PECA_CENTAVOS = 1_000_000;

/**
 * RN-11: o Administrador e a Direção sempre alteram produtos e preços; o Atendimento só quando o Administrador deu a
 * permissão. O setor nunca (não vê valores).
 */
export const podeGerenciarPrecos = (perfil: Pick<Perfil, 'papel' | 'gerenciaPrecos'>): boolean =>
  perfil.papel === 'admin' || perfil.papel === 'direcao' || (perfil.papel === 'atendimento' && perfil.gerenciaPrecos === true);

const preco = (campo: string) =>
  z
    .number(`Informe o preço ${campo}.`)
    .int('O preço precisa estar em centavos inteiros.')
    .min(1, `O preço ${campo} precisa ser maior que zero.`)
    .max(PRECO_MAXIMO_POR_PECA_CENTAVOS, `O preço ${campo} é alto demais. Confira o que foi digitado.`);

/** O catálogo guarda nome e malha em maiúsculas, com espaços simples (como no sistema atual), para a busca e o nome do produto baterem. */
const maiusculas = (texto: string) => texto.replace(/\s+/g, ' ').toUpperCase();

/** Até quantas faixas de preço um produto pode ter. */
export const FAIXAS_POR_PRODUTO = 5;

/**
 * RN-07 e RN-08: as faixas de preço do produto. A primeira começa em 1 peça (uma faixa só = preço único); as quantidades
 * crescem sem repetir; e o preço não sobe quando a quantidade sobe (barra erro de digitação).
 */
export const faixasBody = z
  .array(
    z.object({
      aPartirDe: z.number('Informe a quantidade da faixa.').int('A quantidade precisa ser um número inteiro.').min(1, 'A quantidade precisa ser pelo menos 1.').max(100_000, 'A quantidade é alta demais.'),
      centavos: preco('por peça'),
    }),
  )
  .min(1, 'Informe pelo menos um preço.')
  .max(FAIXAS_POR_PRODUTO, `O produto pode ter até ${FAIXAS_POR_PRODUTO} faixas de preço.`)
  .superRefine((faixas, ctx) => {
    if (faixas[0] && faixas[0].aPartirDe !== 1) {
      ctx.addIssue({ code: 'custom', path: [0, 'aPartirDe'], message: 'A primeira faixa começa em 1 peça.' });
    }
    for (let i = 1; i < faixas.length; i++) {
      const [antes, agora] = [faixas[i - 1]!, faixas[i]!];
      if (agora.aPartirDe <= antes.aPartirDe) {
        ctx.addIssue({ code: 'custom', path: [i, 'aPartirDe'], message: `A faixa ${i + 1} precisa começar depois de ${antes.aPartirDe} peças.` });
      }
      if (agora.centavos > antes.centavos) {
        ctx.addIssue({ code: 'custom', path: [i, 'centavos'], message: `O preço da faixa ${i + 1} não pode ser maior que o da faixa anterior.` });
      }
    }
  });

/** RN-11: criar ou alterar um produto. Preços em centavos, por peça, em faixas de quantidade (`faixasBody`). */
export const produtoBody = z.object({
  nome: z.string().trim().min(3, 'Informe o nome do produto.').max(120, 'O nome do produto é longo demais.').transform(maiusculas),
  malha: z.string().trim().min(2, 'Informe a malha.').max(60, 'O nome da malha é longo demais.').transform(maiusculas),
  faixas: faixasBody,
  /** Produto desativado sai do pedido novo; os pedidos já feitos mantêm o preço do dia. */
  ativo: z.boolean().default(true),
});
export type ProdutoBody = z.infer<typeof produtoBody>;

/** Uma linha da tela de preços: o produto com as faixas de preço, se está ativo e a última alteração. */
export interface ProdutoDePreco {
  id: string;
  nome: string;
  malha: string;
  faixas: FaixaDePreco[];
  ativo: boolean;
  atualizadoEm: string;
  /** Quem alterou por último (vazio nos produtos que vieram da carga inicial). */
  atualizadoPor: string | null;
}

export const gerenciaPrecosBody = z.object({ gerenciaPrecos: z.boolean() });
