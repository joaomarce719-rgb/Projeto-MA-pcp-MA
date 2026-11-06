import { describe, expect, it } from 'vitest';
import { abrePedidos, gerenciaUsuarios, registraPagamentos, trabalhaNaEtapa, veDadosPessoais, veQuadro, veValores } from './index';

describe('veValores (RF-02)', () => {
  it('atendimento, direção e admin veem valores', () => {
    for (const papel of ['atendimento', 'direcao', 'admin'] as const) expect(veValores({ papel })).toBe(true);
  });

  it('o setor nunca', () => {
    expect(veValores({ papel: 'setor' })).toBe(false);
  });
});

describe('registraPagamentos (RF-27, RF-28)', () => {
  it('atendimento, direção e admin registram', () => {
    for (const papel of ['atendimento', 'direcao', 'admin'] as const) expect(registraPagamentos({ papel })).toBe(true);
  });

  it('o setor nunca', () => {
    expect(registraPagamentos({ papel: 'setor' })).toBe(false);
  });
});

describe('veDadosPessoais (RNF-02)', () => {
  it('atendimento, direção e admin veem dados pessoais; o setor nunca', () => {
    for (const papel of ['atendimento', 'direcao', 'admin'] as const) expect(veDadosPessoais({ papel })).toBe(true);
    expect(veDadosPessoais({ papel: 'setor' })).toBe(false);
  });
});

describe('demais permissões por perfil', () => {
  const quem = (regra: (p: { papel: 'atendimento' | 'setor' | 'direcao' | 'admin' }) => boolean) =>
    (['atendimento', 'setor', 'direcao', 'admin'] as const).filter((papel) => regra({ papel }));

  it('abrePedidos: atendimento e admin', () => expect(quem(abrePedidos)).toEqual(['atendimento', 'admin']));
  it('veQuadro: direção e admin', () => expect(quem(veQuadro)).toEqual(['direcao', 'admin']));
  it('gerenciaUsuarios: só admin', () => expect(quem(gerenciaUsuarios)).toEqual(['admin']));
});

describe('trabalhaNaEtapa (RN-19)', () => {
  it('o setor só mexe no pedido que está com ele', () => {
    expect(trabalhaNaEtapa({ papel: 'setor', setor: 'Costura' }, 'Costura')).toBe(true);
    expect(trabalhaNaEtapa({ papel: 'setor', setor: 'Costura' }, 'Laser')).toBe(false);
  });

  it('o admin mexe em qualquer etapa; atendimento e direção em nenhuma', () => {
    expect(trabalhaNaEtapa({ papel: 'admin', setor: null }, 'Laser')).toBe(true);
    expect(trabalhaNaEtapa({ papel: 'atendimento', setor: null }, 'Laser')).toBe(false);
    expect(trabalhaNaEtapa({ papel: 'direcao', setor: null }, 'Laser')).toBe(false);
  });
});
