import { describe, expect, it } from 'vitest';
import {
  clienteBody,
  devolverBody,
  ehDiaValido,
  erroDaDataDeEntrega,
  pedidoBody,
  quantidadeDaGrade,
  somarDias,
} from './index';

const base = {
  tipo: 'Cliente',
  clienteId: '11111111-1111-4111-8111-111111111111',
  dataEntrega: '2026-11-10',
  itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 6, G: 4 } }],
};

function erros(corpo: unknown): Record<string, string> {
  const r = pedidoBody.safeParse(corpo);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('grade', () => {
  it('soma só os tamanhos do modo', () => {
    expect(quantidadeDaGrade('adulto', { M: 6, G: 4, '8': 99 })).toBe(10);
    expect(quantidadeDaGrade('infantil', { '8': 3, '10': 2, M: 50 })).toBe(5);
    expect(quantidadeDaGrade('adulto', {})).toBe(0);
  });
});

describe('pedido válido', () => {
  it('aceita e aplica os padrões (prioridade Normal, sem bordado, sem punho)', () => {
    const r = pedidoBody.parse(base);
    expect(r.prioridade).toBe('Normal');
    expect(r.bordado).toBe(false);
    expect(r.punho).toBe('Sem punho');
    expect(r.itens[0]!.adicionais).toEqual({ patch: false, punho: false, golaV: false });
  });
});

describe('RN-03: cliente ou descrição da feira', () => {
  it('Cliente sem clienteId é recusado', () => {
    expect(erros({ ...base, clienteId: undefined })).toHaveProperty('clienteId');
  });
  it('clienteId que não é um UUID é recusado', () => {
    expect(erros({ ...base, clienteId: 'abc' })).toHaveProperty('clienteId');
  });
  it('Feira exige descrição de pelo menos 3 letras', () => {
    expect(erros({ ...base, tipo: 'Feira', clienteId: undefined })).toHaveProperty('descricao');
    expect(erros({ ...base, tipo: 'Feira', clienteId: undefined, descricao: 'ab' })).toHaveProperty('descricao');
    expect(erros({ ...base, tipo: 'Feira', clienteId: undefined, descricao: 'Feira do Centro' })).toEqual({});
  });
});

describe('RN-04: produtos e grade', () => {
  it('exige pelo menos um produto', () => {
    expect(erros({ ...base, itens: [] })).toHaveProperty('itens');
  });
  it('recusa produto com a grade zerada', () => {
    const e = erros({ ...base, itens: [{ produto: 'Camisa infantil', modo: 'infantil', grade: { '8': 0 } }] });
    expect(e['itens.0.grade']).toMatch(/Preencha a grade/);
  });
  it('recusa tamanho que não existe no modo', () => {
    const e = erros({ ...base, itens: [{ produto: 'Camisa adulto', modo: 'adulto', grade: { M: 2, '8': 3 } }] });
    expect(e['itens.0.grade.8']).toMatch(/não existe/);
  });
  it('recusa quantidade negativa ou fracionada', () => {
    expect(Object.keys(erros({ ...base, itens: [{ produto: 'Camisa adulto', modo: 'adulto', grade: { M: -1 } }] }))).not.toHaveLength(0);
    expect(Object.keys(erros({ ...base, itens: [{ produto: 'Camisa adulto', modo: 'adulto', grade: { M: 1.5 } }] }))).not.toHaveLength(0);
  });
});

describe('RN-13 e RN-14: coerência do cadastro', () => {
  const comAdicional = (adicionais: object) => ({
    ...base,
    itens: [{ produto: 'Camisa adulto malha 3d', modo: 'adulto', grade: { M: 10 }, adicionais }],
  });

  it('patch exige bordado', () => {
    expect(erros(comAdicional({ patch: true }))).toHaveProperty('bordado');
    expect(erros({ ...comAdicional({ patch: true }), bordado: true })).toEqual({});
  });
  it('adicional punho exige um tipo de punho', () => {
    expect(erros(comAdicional({ punho: true }))).toHaveProperty('punho');
    expect(erros({ ...comAdicional({ punho: true }), punho: 'Punho ribana' })).toEqual({});
  });
  it('punho escolhido sem o adicional é aceito (a cobrança é outra regra)', () => {
    expect(erros({ ...base, punho: 'Punho com listra' })).toEqual({});
  });
});

describe('RN-05: data de entrega', () => {
  it('reconhece só dias que existem', () => {
    expect(ehDiaValido('2026-10-23')).toBe(true);
    expect(ehDiaValido('2026-02-31')).toBe(false);
    expect(ehDiaValido('23/10/2026')).toBe(false);
    expect(ehDiaValido('')).toBe(false);
  });
  it('não aceita data passada, aceita hoje', () => {
    expect(erroDaDataDeEntrega('2026-10-22', '2026-10-23')).toMatch(/passado/);
    expect(erroDaDataDeEntrega('2026-10-23', '2026-10-23')).toBeNull();
    expect(erroDaDataDeEntrega('2026-12-01', '2026-10-23')).toBeNull();
    expect(erroDaDataDeEntrega('texto', '2026-10-23')).toMatch(/Informe/);
  });
  it('somarDias atravessa mês e ano', () => {
    expect(somarDias('2026-10-23', 10)).toBe('2026-11-02');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('cliente e devolução', () => {
  it('cliente exige nome de pelo menos 3 letras', () => {
    expect(clienteBody.safeParse({ nome: 'Al' }).success).toBe(false);
    expect(clienteBody.safeParse({ nome: '  Clube Exemplo  ' })).toMatchObject({ success: true, data: { nome: 'Clube Exemplo' } });
  });
  it('devolução exige motivo de pelo menos 3 letras e a versão', () => {
    expect(devolverBody.safeParse({ versao: 1, motivo: 'ok' }).success).toBe(false);
    expect(devolverBody.safeParse({ versao: 1, motivo: '   ' }).success).toBe(false);
    expect(devolverBody.safeParse({ motivo: '3 peças M com falha' }).success).toBe(false);
    expect(devolverBody.safeParse({ versao: 2, motivo: '3 peças M com falha' }).success).toBe(true);
  });
});
