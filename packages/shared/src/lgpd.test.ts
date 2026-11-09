import { describe, expect, it } from 'vitest';
import { anonimizarAPartirDe, confirmaNome, ehCnpj, erroDaAnonimizacao, removerDadosPessoais } from './index';

describe('anonimizarAPartirDe (prazo de guarda, art. 173 do CTN)', () => {
  it('conta 5 anos a partir de 1º de janeiro do ano seguinte ao pedido mais recente', () => {
    expect(anonimizarAPartirDe(['2026-11-09'], '2026-11-09')).toBe('2032-01-01');
    expect(anonimizarAPartirDe(['2020-03-01', '2024-12-31', '2022-06-10'], '2026-11-09')).toBe('2030-01-01');
  });

  it('sem pedido, pode na hora', () => {
    expect(anonimizarAPartirDe([], '2026-11-09')).toBe('2026-11-09');
  });
});

describe('ehCnpj', () => {
  it('14 dígitos é CNPJ; CPF, vazio e outros não', () => {
    expect(ehCnpj('12.345.678/0001-90')).toBe(true);
    expect(ehCnpj('123.456.789-01')).toBe(false);
    expect(ehCnpj(null)).toBe(false);
  });
});

describe('erroDaAnonimizacao', () => {
  const pode = { documento: '123.456.789-01', anonimizado: false, pedidosEmAndamento: 0, liberadoEm: '2026-01-01', hoje: '2026-11-09' };

  it('passa quando nada impede', () => {
    expect(erroDaAnonimizacao(pode)).toBeNull();
  });

  it('recusa já anonimizado, CNPJ, pedido em andamento e prazo de guarda, dizendo até quando', () => {
    expect(erroDaAnonimizacao({ ...pode, anonimizado: true })).toMatch(/já foi anonimizado/);
    expect(erroDaAnonimizacao({ ...pode, documento: '12.345.678/0001-90' })).toMatch(/CNPJ/);
    expect(erroDaAnonimizacao({ ...pode, pedidosEmAndamento: 2 })).toMatch(/2 pedido\(s\) em andamento/);
    expect(erroDaAnonimizacao({ ...pode, liberadoEm: '2032-01-01' })).toMatch(/até 01\/01\/2032/);
  });

  it('no próprio dia liberado, já pode', () => {
    expect(erroDaAnonimizacao({ ...pode, liberadoEm: '2026-11-09' })).toBeNull();
  });
});

describe('removerDadosPessoais', () => {
  const ana = { nome: 'Ana Maria Souza', documento: '123.456.789-01', telefone: '(85) 98888-7777' };

  it('troca o nome completo por palavra inteira, sem diferenciar maiúsculas', () => {
    expect(removerDadosPessoais('Entregar para ANA MARIA  SOUZA na portaria', ana)).toBe('Entregar para [removido] na portaria');
    expect(removerDadosPessoais('Ana Maria Souzazinha', ana)).toBe('Ana Maria Souzazinha');
  });

  it('troca CPF e telefone com ou sem pontuação, sem mexer em números maiores', () => {
    expect(removerDadosPessoais('CPF 12345678901, fone 85 98888 7777', ana)).toBe('CPF [removido], fone [removido]');
    expect(removerDadosPessoais('Ligar no (85) 98888-7777.', ana)).toBe('Ligar no [removido].');
    expect(removerDadosPessoais('nota 9123456789012', ana)).toBe('nota 9123456789012');
  });

  it('nome curto não é trocado (revisão manual): "Ana" não estraga "Banana"', () => {
    expect(removerDadosPessoais('Banana e Ana', { nome: 'Ana', documento: null, telefone: null })).toBe('Banana e Ana');
  });
});

describe('confirmaNome', () => {
  it('ignora maiúsculas e espaços nas pontas; outro nome não confirma', () => {
    expect(confirmaNome('  ana maria souza ', 'Ana Maria Souza')).toBe(true);
    expect(confirmaNome('Ana Souza', 'Ana Maria Souza')).toBe(false);
  });
});
