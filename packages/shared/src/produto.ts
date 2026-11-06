import { z } from 'zod';
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

/** RN-11: criar ou alterar um produto. Preços em centavos, por peça: 10 peças ou mais ("maior") e menos de 10 ("menor"). */
export const produtoBody = z
  .object({
    nome: z.string().trim().min(3, 'Informe o nome do produto.').max(120, 'O nome do produto é longo demais.').transform(maiusculas),
    malha: z.string().trim().min(2, 'Informe a malha.').max(60, 'O nome da malha é longo demais.').transform(maiusculas),
    maiorCentavos: preco('de 10 peças ou mais'),
    menorCentavos: preco('de menos de 10 peças'),
    /** Produto desativado sai do pedido novo; os pedidos já feitos mantêm o preço do dia. */
    ativo: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.maiorCentavos > p.menorCentavos) {
      ctx.addIssue({
        code: 'custom',
        path: ['maiorCentavos'],
        message: 'O preço de 10 peças ou mais não pode ser maior que o de menos de 10 peças.',
      });
    }
  });
export type ProdutoBody = z.infer<typeof produtoBody>;

/** Uma linha da tela de preços: o produto com os dois preços, se está ativo e a última alteração. */
export interface ProdutoDePreco {
  id: string;
  nome: string;
  malha: string;
  maiorCentavos: number;
  menorCentavos: number;
  ativo: boolean;
  atualizadoEm: string;
  /** Quem alterou por último (vazio nos produtos que vieram da carga inicial). */
  atualizadoPor: string | null;
}

export const gerenciaPrecosBody = z.object({ gerenciaPrecos: z.boolean() });
