import { describe, expect, it } from 'vitest';
import {
  abrePedidos,
  cuidaDaLgpd,
  gerenciaUsuarios,
  mascararDocumento,
  paginaInicial,
  registraPagamentos,
  trabalhaNaEtapa,
  veDadosPessoais,
  veQuadro,
  veValores,
} from './index';

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
  it('cuidaDaLgpd: só admin', () => expect(quem(cuidaDaLgpd)).toEqual(['admin']));
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

describe('paginaInicial', () => {
  it('a Direção abre no Quadro; os demais, nos pedidos', () => {
    expect(paginaInicial({ papel: 'direcao' })).toBe('/quadro');
    for (const papel of ['atendimento', 'setor', 'admin'] as const) expect(paginaInicial({ papel })).toBe('/fila');
  });
});

describe('mascararDocumento (RNF-02)', () => {
  it('CPF mostra só os dígitos do meio, com ou sem pontuação', () => {
    expect(mascararDocumento('123.456.789-01')).toBe('***.456.789-**');
    expect(mascararDocumento('12345678901')).toBe('***.456.789-**');
  });

  it('CNPJ é da empresa: sai inteiro, como foi digitado', () => {
    expect(mascararDocumento('00.000.000/0001-00')).toBe('00.000.000/0001-00');
  });

  it('outro formato: só os dois últimos dígitos aparecem; vazio continua vazio', () => {
    expect(mascararDocumento('RG 1234567')).toBe('RG *****67');
    expect(mascararDocumento(null)).toBeNull();
    expect(mascararDocumento('')).toBeNull();
  });
});
