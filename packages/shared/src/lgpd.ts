import { z } from 'zod';

/**
 * Prazo de guarda dos dados de uma venda (obrigação legal, LGPD art. 16, I e art. 7, II). Conta-se como no art. 173 do
 * CTN: anos inteiros a partir de 1º de janeiro do ano seguinte ao do pedido. O número é do contador; muda aqui só.
 */
export const PRAZO_DE_GUARDA_ANOS = 5;

/** O texto que substitui o nome do cliente anonimizado (no cadastro e na descrição dos pedidos). */
export const CLIENTE_REMOVIDO = 'Cliente removido';

/** O texto que substitui nome, CPF e telefone dentro das observações. */
export const DADO_REMOVIDO = '[removido]';

/** CNPJ (14 dígitos) é de empresa: a LGPD protege pessoa natural, então não há o que anonimizar. */
export const ehCnpj = (documento: string | null): boolean => (documento ?? '').replace(/\D/g, '').length === 14;

/**
 * A partir de quando os dados do cliente podem ser anonimizados (AAAA-MM-DD): o fim do prazo de guarda contado do pedido
 * mais recente (`diasDosPedidos`, a data de cada pedido em AAAA-MM-DD). Sem pedido, pode na hora (`hoje`).
 */
export function anonimizarAPartirDe(diasDosPedidos: string[], hoje: string): string {
  if (diasDosPedidos.length === 0) return hoje;
  const ultimoAno = Math.max(...diasDosPedidos.map((d) => Number(d.slice(0, 4))));
  return `${ultimoAno + 1 + PRAZO_DE_GUARDA_ANOS}-01-01`;
}

/** Situação do cliente para a anonimização: o que ainda impede, ou null se pode. */
export interface SituacaoParaAnonimizar {
  documento: string | null;
  anonimizado: boolean;
  pedidosEmAndamento: number;
  liberadoEm: string;
  hoje: string;
}

/** As regras da anonimização (LGPD, com o prazo fiscal). Devolve a frase para a pessoa, ou null se pode anonimizar. */
export function erroDaAnonimizacao(s: SituacaoParaAnonimizar): string | null {
  if (s.anonimizado) return 'Este cliente já foi anonimizado.';
  if (ehCnpj(s.documento)) return 'CNPJ é de empresa: a LGPD não se aplica, e o cadastro não é anonimizado.';
  if (s.pedidosEmAndamento > 0) {
    return `O cliente tem ${s.pedidosEmAndamento} pedido(s) em andamento. Só depois de concluídos e do prazo de guarda.`;
  }
  if (s.hoje < s.liberadoEm) {
    const [a, m, d] = s.liberadoEm.split('-');
    return `Os dados ficam guardados por obrigação legal até ${d}/${m}/${a}. A anonimização fica liberada a partir dessa data.`;
  }
  return null;
}

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Os dígitos podem vir com pontos, traços, barras, espaços ou parênteses entre eles: "123.456.789-01", "(85) 9...". */
const porDigitos = (digitos: string) => digitos.split('').join('[\\s.\\-/()]*');

/**
 * Troca, num texto livre (observações), o nome completo, o documento e o telefone do cliente por `[removido]`.
 * O nome só troca por palavra inteira e sem diferenciar maiúsculas ("Ana" não mexe em "Banana"); nomes com menos de
 * 5 letras ficam para a revisão manual, porque trocariam palavras comuns. Documento e telefone trocam com ou sem pontuação.
 */
export function removerDadosPessoais(
  texto: string,
  cliente: { nome: string; documento: string | null; telefone: string | null },
): string {
  let resultado = texto;
  const nome = cliente.nome.trim();
  if (nome.length >= 5) {
    const padrao = escapar(nome).replace(/\s+/g, '\\s+');
    resultado = resultado.replace(new RegExp(`(?<![\\p{L}\\p{N}])${padrao}(?![\\p{L}\\p{N}])`, 'giu'), DADO_REMOVIDO);
  }
  for (const numero of [cliente.documento, cliente.telefone]) {
    const digitos = (numero ?? '').replace(/\D/g, '');
    if (digitos.length >= 8) resultado = resultado.replace(new RegExp(`(?<!\\d)\\(?${porDigitos(digitos)}(?!\\d)`, 'g'), DADO_REMOVIDO);
  }
  return resultado;
}

/** A confirmação da anonimização: a pessoa digita o nome do cliente, sem diferença de maiúsculas nem espaços nas pontas. */
export const confirmaNome = (digitado: string, nome: string): boolean =>
  digitado.trim().toLocaleLowerCase('pt-BR') === nome.trim().toLocaleLowerCase('pt-BR');

export const pedidoDeExclusaoBody = z.object({
  motivo: z.string().trim().min(3, 'Descreva o pedido (quem pediu, por qual canal, quando).').max(500),
});
export type PedidoDeExclusaoBody = z.infer<typeof pedidoDeExclusaoBody>;

export const anonimizarBody = z.object({
  confirmacao: z.string().trim().min(1, 'Digite o nome do cliente para confirmar.').max(200),
});
export type AnonimizarBody = z.infer<typeof anonimizarBody>;

/** Uma linha da lista "Clientes a anonimizar" (só o Administrador vê). */
export interface ClienteAAnonimizar {
  id: string;
  nome: string;
  exclusaoPedidaEm: string;
  motivo: string;
  pedidosEmAndamento: number;
  liberadoEm: string;
  /** Pode anonimizar hoje (`erroDaAnonimizacao` sem erro). */
  pode: boolean;
  /** Se não pode, o porquê, já em português para a tela. */
  impedimento: string | null;
}
