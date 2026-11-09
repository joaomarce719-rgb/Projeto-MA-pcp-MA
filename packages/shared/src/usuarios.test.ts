import { describe, expect, it } from 'vitest';
import { ativoBody, edicaoUsuarioBody, mudancasDoUsuario, podeEditarUsuario, senhaBody, usuarioBody } from './index';

describe('editar usuário (RF-04)', () => {
  const erroDa = (corpo: unknown) => {
    const r = edicaoUsuarioBody.safeParse(corpo);
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
  };

  it('mesmas regras de nome, papel e setor da criação, sem e-mail nem senha', () => {
    expect(erroDa({ nome: 'A', papel: 'atendimento' }).nome).toBe('Informe o nome da pessoa.');
    expect(erroDa({ nome: 'Maria', papel: 'setor' }).setor).toBe('Escolha o setor desta pessoa.');
    expect(erroDa({ nome: 'Maria', papel: 'atendimento', setor: 'Laser' }).setor).toBe('Só quem é de setor tem setor.');
    expect(edicaoUsuarioBody.parse({ nome: '  Maria  ', papel: 'setor', setor: 'Laser' })).toEqual({ nome: 'Maria', papel: 'setor', setor: 'Laser' });
  });

  const atual = { nome: 'João', papel: 'setor' as const, setor: 'Costura', gerenciaPrecos: false };

  it('sem mudança, nada a registrar', () => {
    expect(mudancasDoUsuario(atual, { nome: 'João', papel: 'setor', setor: 'Costura' })).toBeNull();
  });

  it('só o que mudou entra no antes e depois', () => {
    expect(mudancasDoUsuario(atual, { nome: 'João', papel: 'setor', setor: 'Embalagem' })).toEqual({
      antes: { setor: 'Costura' },
      depois: { setor: 'Embalagem' },
    });
  });

  it('sair do Atendimento tira a permissão de gerenciar preços', () => {
    const at = { nome: 'Rita', papel: 'atendimento' as const, setor: null, gerenciaPrecos: true };
    expect(mudancasDoUsuario(at, { nome: 'Rita', papel: 'direcao' })).toEqual({
      antes: { papel: 'atendimento', gerenciaPrecos: true },
      depois: { papel: 'direcao', gerenciaPrecos: false },
    });
  });

  it('o Administrador não tira de si o papel de Administrador', () => {
    expect(podeEditarUsuario('a', 'a', 'direcao')).toBe(false);
    expect(podeEditarUsuario('a', 'a', 'admin')).toBe(true);
    expect(podeEditarUsuario('a', 'b', 'direcao')).toBe(true);
  });
});

const base = { nome: 'Maria Souza', email: 'maria@ma.com.br', senha: 'senha-segura-1', papel: 'atendimento' };

function erros(corpo: unknown): Record<string, string> {
  const r = usuarioBody.safeParse(corpo);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('criar usuário (RF-04)', () => {
  it('aceita um usuário válido e normaliza o e-mail', () => {
    const r = usuarioBody.parse({ ...base, email: '  Maria@MA.com.br ' });
    expect(r.email).toBe('maria@ma.com.br');
  });

  it('e-mail inválido é recusado', () => {
    expect(erros({ ...base, email: 'maria' })).toHaveProperty('email');
    expect(erros({ ...base, email: '' })).toHaveProperty('email');
  });

  it('senha precisa de pelo menos 8 caracteres', () => {
    expect(erros({ ...base, senha: '1234567' }).senha).toMatch(/pelo menos 8/);
    expect(erros({ ...base, senha: '12345678' })).toEqual({});
  });

  it('quem é de setor precisa de um setor que exista', () => {
    expect(erros({ ...base, papel: 'setor' })).toHaveProperty('setor');
    expect(erros({ ...base, papel: 'setor', setor: 'Cozinha' })).toHaveProperty('setor');
    expect(erros({ ...base, papel: 'setor', setor: 'Laser' })).toEqual({});
  });

  it('quem não é de setor não leva setor', () => {
    expect(erros({ ...base, papel: 'direcao', setor: 'Laser' })).toHaveProperty('setor');
    expect(erros({ ...base, papel: 'admin' })).toEqual({});
  });

  it('papel desconhecido é recusado', () => {
    expect(erros({ ...base, papel: 'chefe' })).toHaveProperty('papel');
  });

  it('ativar e trocar senha', () => {
    expect(ativoBody.safeParse({ ativo: false }).success).toBe(true);
    expect(ativoBody.safeParse({ ativo: 'não' }).success).toBe(false);
    expect(senhaBody.safeParse({ senha: 'curta' }).success).toBe(false);
    expect(senhaBody.safeParse({ senha: 'uma-senha-boa' }).success).toBe(true);
  });
});
