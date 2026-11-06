import { z } from 'zod';
import { SETORES } from './rota';
import { papeis, type Papel } from './schemas';

export const SENHA_MINIMA = 8;

const senha = z
  .string()
  .min(SENHA_MINIMA, `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`)
  .max(72, 'A senha pode ter no máximo 72 caracteres.');

/** RF-04: o Administrador cria o acesso de cada pessoa. Setor é obrigatório para quem é de setor, e só para eles. */
export const usuarioBody = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome da pessoa.').max(80),
    email: z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail válido.')),
    senha,
    papel: z.enum(papeis),
    setor: z.enum(SETORES).optional(),
  })
  .superRefine((u, ctx) => {
    if (u.papel === 'setor' && !u.setor) {
      ctx.addIssue({ code: 'custom', path: ['setor'], message: 'Escolha o setor desta pessoa.' });
    }
    if (u.papel !== 'setor' && u.setor) {
      ctx.addIssue({ code: 'custom', path: ['setor'], message: 'Só quem é de setor tem setor.' });
    }
  });
export type UsuarioBody = z.infer<typeof usuarioBody>;

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
