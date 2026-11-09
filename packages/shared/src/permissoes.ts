import type { Perfil } from './schemas';

/**
 * RF-02 e REFERENCIA §3: quem recebe valores em dinheiro (total, recebido, saldo, preços, orçamento e financeiro).
 * Lista quem pode: um perfil novo começa sem acesso. O setor nunca.
 */
export const veValores = (perfil: Pick<Perfil, 'papel'>): boolean =>
  perfil.papel === 'atendimento' || perfil.papel === 'direcao' || perfil.papel === 'admin';

/**
 * RF-27, RF-28 e REFERENCIA §3: quem registra recebimentos e comprovantes e confirma a entrega.
 * Hoje são os mesmos perfis de `veValores`, mas é outra decisão: pode mudar sem mudar quem vê.
 */
export const registraPagamentos = (perfil: Pick<Perfil, 'papel'>): boolean =>
  perfil.papel === 'atendimento' || perfil.papel === 'direcao' || perfil.papel === 'admin';

/** RNF-02 (LGPD): CPF/CNPJ, telefone e endereço do cliente. Lista quem pode; o setor nunca. */
export const veDadosPessoais = (perfil: Pick<Perfil, 'papel'>): boolean =>
  perfil.papel === 'atendimento' || perfil.papel === 'direcao' || perfil.papel === 'admin';

/** RF-09, RF-11 e RF-14: quem cadastra clientes, abre pedidos e envia fotos. A Direção não (REFERENCIA §3). */
export const abrePedidos = (perfil: Pick<Perfil, 'papel'>): boolean =>
  perfil.papel === 'atendimento' || perfil.papel === 'admin';

/** RF-29 a RF-32: quem vê o Quadro. */
export const veQuadro = (perfil: Pick<Perfil, 'papel'>): boolean => perfil.papel === 'direcao' || perfil.papel === 'admin';

/** RF-04: quem gerencia usuários. */
export const gerenciaUsuarios = (perfil: Pick<Perfil, 'papel'>): boolean => perfil.papel === 'admin';

/** RN-19: só o setor onde o pedido está (ou o Administrador) mexe nele. Se a etapa é de produção, quem confere é quem chama. */
export const trabalhaNaEtapa = (perfil: Pick<Perfil, 'papel' | 'setor'>, etapa: string): boolean =>
  perfil.papel === 'admin' || (perfil.papel === 'setor' && perfil.setor === etapa);

/** Primeira tela depois de entrar: a Direção abre no Quadro; os demais, nos pedidos (ou na fila do setor). */
export const paginaInicial = (perfil: Pick<Perfil, 'papel'>): '/quadro' | '/fila' =>
  perfil.papel === 'direcao' ? '/quadro' : '/fila';

/**
 * RNF-02 (LGPD, minimização): documento como sai na busca de clientes. CPF (11 dígitos) é de pessoa: mostra só os do
 * meio (***.456.789-**). CNPJ (14 dígitos) é da empresa e público: sai inteiro, como foi digitado. Outro formato: só os
 * dois últimos dígitos aparecem.
 */
export function mascararDocumento(documento: string | null): string | null {
  if (!documento) return null;
  const d = documento.replace(/\D/g, '');
  if (d.length === 14) return documento;
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  let resto = d.length - 2;
  return documento.replace(/\d/g, (c) => (resto-- > 0 ? '*' : c));
}

/** LGPD: quem registra pedidos de exclusão e anonimiza clientes. Só o Administrador. */
export const cuidaDaLgpd = (perfil: Pick<Perfil, 'papel'>): boolean => perfil.papel === 'admin';
