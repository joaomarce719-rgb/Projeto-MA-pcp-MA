import { z } from 'zod';
import { SETORES } from './rota';
import { papeis, type Papel } from './schemas';

export const SENHA_MINIMA = 8;

const senha = z
  .string()
  .min(SENHA_MINIMA, `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`)
  .max(72, 'A senha pode ter no máximo 72 caracteres.');

const nomePapelSetor = {
  nome: z.string().trim().min(2, 'Informe o nome da pessoa.').max(80),
  papel: z.enum(papeis),
  setor: z.enum(SETORES).optional(),
};

/** Setor é obrigatório para quem é de setor, e só para eles (na criação e na edição). */
function conferirSetor(u: { papel: Papel; setor?: string }, ctx: z.RefinementCtx) {
  if (u.papel === 'setor' && !u.setor) {
    ctx.addIssue({ code: 'custom', path: ['setor'], message: 'Escolha o setor desta pessoa.' });
  }
  if (u.papel !== 'setor' && u.setor) {
    ctx.addIssue({ code: 'custom', path: ['setor'], message: 'Só quem é de setor tem setor.' });
  }
}

/** RF-04: o Administrador cria o acesso de cada pessoa. */
export const usuarioBody = z
  .object({
    ...nomePapelSetor,
    email: z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail válido.')),
    senha,
  })
  .superRefine(conferirSetor);
export type UsuarioBody = z.infer<typeof usuarioBody>;

/** RF-04: o Administrador muda nome, papel e setor de quem já existe. E-mail, senha e situação têm as suas rotas. */
export const edicaoUsuarioBody = z.object(nomePapelSetor).superRefine(conferirSetor);
export type EdicaoUsuarioBody = z.infer<typeof edicaoUsuarioBody>;

/** Os campos do perfil que a edição pode mudar, como ficam gravados. */
export interface CamposEditaveis {
  nome: string;
  papel: Papel;
  setor: string | null;
  gerenciaPrecos: boolean;
}

/**
 * O que a edição muda, para gravar no registro de alterações: só os campos diferentes, com o valor de antes e o de
 * depois. Sair do Atendimento tira a permissão de gerenciar preços (RN-11). Sem diferença, `null`: nada a gravar.
 */
export function mudancasDoUsuario(
  atual: CamposEditaveis,
  edicao: EdicaoUsuarioBody,
): { antes: Partial<CamposEditaveis>; depois: Partial<CamposEditaveis> } | null {
  const novo: CamposEditaveis = {
    nome: edicao.nome,
    papel: edicao.papel,
    setor: edicao.papel === 'setor' ? (edicao.setor ?? null) : null,
    gerenciaPrecos: atual.gerenciaPrecos && edicao.papel === 'atendimento',
  };
  const antes: Record<string, unknown> = {};
  const depois: Record<string, unknown> = {};
  for (const campo of ['nome', 'papel', 'setor', 'gerenciaPrecos'] as const) {
    if (atual[campo] !== novo[campo]) {
      antes[campo] = atual[campo];
      depois[campo] = novo[campo];
    }
  }
  return Object.keys(antes).length ? { antes, depois } : null;
}

/** O Administrador não tira de si o papel de Administrador: o sistema nunca fica sem quem o administre. */
export const podeEditarUsuario = (editorId: string, alvoId: string, papelNovo: Papel): boolean =>
  editorId !== alvoId || papelNovo === 'admin';

/** Uma linha do registro de alterações de um usuário (só o Administrador vê). */
export interface AlteracaoUsuario {
  id: string;
  criadoEm: string;
  alteradoPor: string;
  antes: Partial<CamposEditaveis>;
  depois: Partial<CamposEditaveis>;
}

export const ativoBody = z.object({ ativo: z.boolean() });
export const senhaBody = z.object({ senha });

export interface UsuarioLinha {
  id: string;
  nome: string;
  email: string | null;
  papel: Papel;
  setor: string | null;
  ativo: boolean;
  /** RN-11: só o Atendimento tem a marca; o Administrador sempre pode pelo papel. */
  gerenciaPrecos: boolean;
}
