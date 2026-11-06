import { describe, expect, it } from 'vitest';
import {
  malhaDoCalcao,
  mensagemDoOrcamento,
  modoDoProduto,
  nomesDosAdicionais,
  precificarItem,
  resumoDaGrade,
  tituloDoProduto,
  totalCentavos,
  type OrcamentoDoPedido,
} from './index';

describe('preço por item (RN-07 a RN-10)', () => {
  const camisa = { maiorCentavos: 3500, menorCentavos: 4200 };

  it('9 peças pagam a faixa de menos de 10; 10 peças pagam a de 10 ou mais', () => {
    expect(precificarItem({ ...camisa, quantidade: 9, adicionais: {} })).toMatchObject({ precoUnitarioCentavos: 4200, subtotalCentavos: 37_800 });
    expect(precificarItem({ ...camisa, quantidade: 10, adicionais: {} })).toMatchObject({ precoUnitarioCentavos: 3500, subtotalCentavos: 35_000 });
  });

  it('adicionais somam por peça (patch 7, punho 5, gola V 2) em todas as peças do produto', () => {
    const r = precificarItem({ ...camisa, quantidade: 10, adicionais: { patch: true, golaV: true } });
    expect(r.adicionaisUnitarioCentavos).toBe(900);
    expect(r.subtotalCentavos).toBe(10 * (3500 + 900));
  });

  it('o total do pedido é a soma dos subtotais, em centavos inteiros', () => {
    const a = { quantidade: 10, maiorCentavos: 3500, menorCentavos: 4200, adicionais: {} };
    const b = { quantidade: 3, maiorCentavos: 2700, menorCentavos: 3240, adicionais: { punho: true } };
    expect(totalCentavos([a, b])).toBe(35_000 + 3 * (3240 + 500));
  });

  it('a faixa vale por produto, não pelo pedido inteiro (D6)', () => {
    const peq = precificarItem({ maiorCentavos: 3000, menorCentavos: 3600, quantidade: 6, adicionais: {} });
    expect(peq.precoUnitarioCentavos).toBe(3600);
  });
});

describe('malha do calção', () => {
  it('vem dos produtos de calção, bermuda ou calça, sem repetir', () => {
    expect(
      malhaDoCalcao([
        { produto: 'CAMISA ADULTO MALHA DRY FIT', malha: 'DRY FIT' },
        { produto: 'CALÇÃO ADULTO MALHA DRY FIT', malha: 'DRY FIT' },
        { produto: 'BERMUDA ADULTO MALHA DRY FIT', malha: 'DRY FIT' },
        { produto: 'CALÇA ADULTO MALHA HELANCA', malha: 'HELANCA' },
      ]),
    ).toBe('Dry Fit / Helanca');
  });
  it('"Não se aplica" quando não há calção', () => {
    expect(malhaDoCalcao([{ produto: 'CAMISA ADULTO MALHA DRY FIT', malha: 'DRY FIT' }])).toBe('Não se aplica');
    expect(malhaDoCalcao([])).toBe('Não se aplica');
  });
});

describe('nomes e grade', () => {
  it('título com iniciais maiúsculas, mantendo números em maiúsculas', () => {
    expect(tituloDoProduto('CAMISA INFANTIL MALHA 3D MANGA LONGA')).toBe('Camisa Infantil Malha 3D Manga Longa');
    expect(tituloDoProduto('KIT DE CAMISA E CALÇÃO')).toBe('Kit de Camisa e Calção');
  });
  it('produto infantil usa a grade infantil; o resto, a adulta', () => {
    expect(modoDoProduto('CAMISA INFANTIL MALHA DRY FIT')).toBe('infantil');
    expect(modoDoProduto('CAMISA ADULTO MALHA DRY FIT')).toBe('adulto');
  });
  it('resume só os tamanhos com peças, na ordem da grade', () => {
    expect(resumoDaGrade('adulto', { G: 4, M: 6, P: 0 })).toBe('M 6 · G 4');
    expect(resumoDaGrade('infantil', { '10': 2, '6': 1 })).toBe('6 1 · 10 2');
  });
  it('lista os nomes dos adicionais marcados', () => {
    expect(nomesDosAdicionais({ patch: true, punho: false, golaV: true })).toEqual(['Patch', 'Gola V']);
    expect(nomesDosAdicionais(undefined)).toEqual([]);
  });
});

describe('mensagem do WhatsApp (RF-17)', () => {
  const base: OrcamentoDoPedido = {
    numero: 42,
    tipo: 'Cliente',
    descricao: 'Clube Exemplo',
    cliente: { nome: 'Clube Exemplo', documento: null, telefone: null, cidade: null },
    criadoEm: '2026-10-27',
    dataEntrega: '2026-11-10',
    prioridade: 'Normal',
    bordado: false,
    itens: [{ produto: 'CAMISA ADULTO MALHA DRY FIT', malha: 'DRY FIT', modo: 'adulto', grade: { M: 6, G: 4 }, quantidade: 10, adicionais: [], unitarioCentavos: 3500, subtotalCentavos: 35_000 }],
    pecas: 10,
    totalCentavos: 35_000,
    recebimentos: [],
    recebidoCentavos: 0,
    saldoCentavos: 35_000,
  };

  it('traz o número, os itens, o total, o prazo e a validade', () => {
    const m = mensagemDoOrcamento(base);
    expect(m).toContain('Olá, Clube Exemplo! Segue o orçamento nº 42 da MA Fardamentos:');
    expect(m).toMatch(/• 10× Camisa Adulto Malha Dry Fit \(M 6 · G 4\) — R\$\s?350,00/);
    expect(m).toMatch(/Total: R\$\s?350,00/);
    expect(m).toContain('Prazo de entrega: 10/11/2026');
    expect(m).toContain('Válido por 30 dias.');
    expect(m).not.toContain('Entrada recebida');
  });

  it('com entrada, mostra o recebido e o saldo', () => {
    const m = mensagemDoOrcamento({ ...base, recebidoCentavos: 10_000, saldoCentavos: 25_000 });
    expect(m).toMatch(/Entrada recebida: R\$\s?100,00 · Saldo: R\$\s?250,00/);
  });
});
