import { describe, expect, it } from 'vitest';
import { PRECO_MAXIMO_POR_PECA_CENTAVOS, podeGerenciarPrecos, produtoBody } from './index';

const valido = { nome: 'Camisa adulto malha dry fit', malha: 'dry fit', maiorCentavos: 3500, menorCentavos: 4200 };

function erros(corpo: unknown): Record<string, string> {
  const r = produtoBody.safeParse(corpo);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('produtoBody (RN-11)', () => {
  it('aceita um produto e padroniza nome e malha em maiúsculas, com espaços simples', () => {
    const r = produtoBody.parse({ ...valido, nome: '  Camisa   adulto malha DRY fit ' });
    expect(r.nome).toBe('CAMISA ADULTO MALHA DRY FIT');
    expect(r.malha).toBe('DRY FIT');
    expect(r.ativo).toBe(true);
  });

  it('aceita preços iguais nas duas faixas', () => {
    expect(erros({ ...valido, maiorCentavos: 4200 })).toEqual({});
  });

  it('exige nome e malha', () => {
    expect(erros({ ...valido, nome: ' ' }).nome).toMatch(/nome do produto/);
    expect(erros({ ...valido, malha: '' }).malha).toMatch(/malha/);
  });

  it('não aceita preço zerado, negativo, quebrado ou ausente', () => {
    expect(erros({ ...valido, maiorCentavos: 0 }).maiorCentavos).toMatch(/maior que zero/);
    expect(erros({ ...valido, menorCentavos: -1 }).menorCentavos).toMatch(/maior que zero/);
    expect(erros({ ...valido, menorCentavos: 10.5 }).menorCentavos).toMatch(/centavos inteiros/);
    expect(erros({ ...valido, menorCentavos: undefined }).menorCentavos).toMatch(/Informe o preço/);
  });

  it('barra preço absurdo por peça', () => {
    expect(erros({ ...valido, menorCentavos: PRECO_MAXIMO_POR_PECA_CENTAVOS + 1 }).menorCentavos).toMatch(/alto demais/);
    expect(erros({ ...valido, maiorCentavos: 1, menorCentavos: PRECO_MAXIMO_POR_PECA_CENTAVOS })).toEqual({});
  });

  it('o preço de 10 peças ou mais não pode passar o de menos de 10', () => {
    expect(erros({ ...valido, maiorCentavos: 5000, menorCentavos: 4200 }).maiorCentavos).toMatch(/não pode ser maior/);
  });
});

describe('podeGerenciarPrecos (RN-11)', () => {
  it('o Administrador e a Direção sempre podem', () => {
    expect(podeGerenciarPrecos({ papel: 'admin', gerenciaPrecos: false })).toBe(true);
    expect(podeGerenciarPrecos({ papel: 'direcao' })).toBe(true);
  });

  it('o Atendimento só pode com a permissão dada', () => {
    expect(podeGerenciarPrecos({ papel: 'atendimento', gerenciaPrecos: true })).toBe(true);
    expect(podeGerenciarPrecos({ papel: 'atendimento', gerenciaPrecos: false })).toBe(false);
    expect(podeGerenciarPrecos({ papel: 'atendimento' })).toBe(false);
  });

  it('o setor nunca, mesmo com a marca ligada por engano', () => {
    expect(podeGerenciarPrecos({ papel: 'setor', gerenciaPrecos: true })).toBe(false);
  });
});
