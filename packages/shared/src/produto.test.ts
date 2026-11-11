import { describe, expect, it } from 'vitest';
import { PRECO_MAXIMO_POR_PECA_CENTAVOS, podeGerenciarPrecos, produtoBody } from './index';

const valido = { nome: 'Camisa adulto malha dry fit', malha: 'dry fit', faixas: [{ aPartirDe: 1, centavos: 4200 }, { aPartirDe: 10, centavos: 3500 }] };
const faixas = (...f: [number, number][]) => f.map(([aPartirDe, centavos]) => ({ aPartirDe, centavos }));

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

  it('exige nome e malha', () => {
    expect(erros({ ...valido, nome: ' ' }).nome).toMatch(/nome do produto/);
    expect(erros({ ...valido, malha: '' }).malha).toMatch(/malha/);
  });
});

describe('faixas de preço (RN-07 e RN-08)', () => {
  it('aceita preço único, preços iguais e até 5 faixas com quantidade livre', () => {
    expect(erros({ ...valido, faixas: faixas([1, 1800]) })).toEqual({});
    expect(erros({ ...valido, faixas: faixas([1, 4200], [10, 4200]) })).toEqual({});
    expect(erros({ ...valido, faixas: faixas([1, 4200], [15, 3800], [20, 3500], [50, 3200], [100, 3000]) })).toEqual({});
  });

  it('exige pelo menos uma faixa e no máximo 5', () => {
    expect(erros({ ...valido, faixas: [] }).faixas).toMatch(/pelo menos um preço/);
    expect(erros({ ...valido, faixas: faixas([1, 9], [2, 8], [3, 7], [4, 6], [5, 5], [6, 4]) }).faixas).toMatch(/até 5 faixas/);
  });

  it('a primeira faixa começa em 1 peça', () => {
    expect(erros({ ...valido, faixas: faixas([10, 3500]) })['faixas.0.aPartirDe']).toMatch(/começa em 1/);
  });

  it('as quantidades crescem, sem repetir', () => {
    expect(erros({ ...valido, faixas: faixas([1, 4200], [20, 3500], [10, 3800]) })['faixas.2.aPartirDe']).toMatch(/depois de 20/);
    expect(erros({ ...valido, faixas: faixas([1, 4200], [10, 3800], [10, 3500]) })['faixas.2.aPartirDe']).toMatch(/depois de 10/);
  });

  it('o preço não sobe quando a quantidade sobe', () => {
    expect(erros({ ...valido, faixas: faixas([1, 3500], [10, 4200]) })['faixas.1.centavos']).toMatch(/não pode ser maior/);
  });

  it('não aceita preço zerado, quebrado, absurdo ou quantidade quebrada', () => {
    expect(erros({ ...valido, faixas: faixas([1, 0]) })['faixas.0.centavos']).toMatch(/maior que zero/);
    expect(erros({ ...valido, faixas: faixas([1, 10.5]) })['faixas.0.centavos']).toMatch(/centavos inteiros/);
    expect(erros({ ...valido, faixas: faixas([1, PRECO_MAXIMO_POR_PECA_CENTAVOS + 1]) })['faixas.0.centavos']).toMatch(/alto demais/);
    expect(erros({ ...valido, faixas: faixas([1, 4200], [9.5, 3800]) })['faixas.1.aPartirDe']).toMatch(/inteiro/);
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
