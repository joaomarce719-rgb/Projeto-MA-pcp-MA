import { describe, expect, it } from 'vitest';
import { ativoBody, senhaBody, usuarioBody } from './index';

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
