import { describe, expect, it } from 'vitest';
import {
  diaEmFortaleza,
  entregaNosProximosDias,
  erroDeConclusao,
  estaAtrasado,
  progressoDoPedido,
  rotaDoPedido,
  lerValorEmCentavos,
  proximaEtapa,
  semaforoDoPrazo,
  subtotalCentavos,
  totalCentavos,
  type LoteRota,
} from './index';

const lote = (p: Partial<LoteRota>): LoteRota => ({
  etapa: 'Design',
  tipo: 'Cliente',
  bordado: false,
  recuperacaoPendente: false,
  ...p,
});

describe('rota dos setores', () => {
  it('segue a ordem Design → Impressão → Batida → Laser → Conferência', () => {
    expect(proximaEtapa(lote({ etapa: 'Design' }))).toBe('Impressão');
    expect(proximaEtapa(lote({ etapa: 'Impressão' }))).toBe('Batida');
    expect(proximaEtapa(lote({ etapa: 'Batida' }))).toBe('Laser');
    expect(proximaEtapa(lote({ etapa: 'Laser' }))).toBe('Conferência');
  });

  it('RN-17: sem bordado, a Conferência vai direto para a Costura', () => {
    expect(proximaEtapa(lote({ etapa: 'Conferência', bordado: false }))).toBe('Costura');
  });

  it('com bordado, a Conferência passa pelo Bordado', () => {
    expect(proximaEtapa(lote({ etapa: 'Conferência', bordado: true }))).toBe('Bordado');
    expect(proximaEtapa(lote({ etapa: 'Bordado', bordado: true }))).toBe('Costura');
  });

  it('RN-18: depois da Embalagem, Cliente vai ao Financeiro e Feira conclui', () => {
    expect(proximaEtapa(lote({ etapa: 'Embalagem', tipo: 'Cliente' }))).toBe('Financeiro');
    expect(proximaEtapa(lote({ etapa: 'Embalagem', tipo: 'Feira' }))).toBe('Concluído');
  });

  it('RN-23: o Design que conclui uma recuperação volta para a Impressão', () => {
    expect(proximaEtapa(lote({ etapa: 'Design', recuperacaoPendente: true }))).toBe('Impressão');
  });

  it('recusa etapa fora da produção', () => {
    expect(() => proximaEtapa(lote({ etapa: 'Financeiro' }))).toThrow();
  });
});

describe('o que cada setor informa para concluir', () => {
  it('RN-20: a Impressão exige máquina 02, 03 ou 04', () => {
    expect(erroDeConclusao('Impressão', {})).toMatch(/máquina/);
    expect(erroDeConclusao('Impressão', { maquina: '05' })).toMatch(/máquina/);
    expect(erroDeConclusao('Impressão', { maquina: '03' })).toBeNull();
  });

  it('RN-21: a Embalagem exige quantidade final de pelo menos 1', () => {
    expect(erroDeConclusao('Embalagem', {})).toMatch(/quantidade/);
    expect(erroDeConclusao('Embalagem', { pecas: 0 })).toMatch(/quantidade/);
    expect(erroDeConclusao('Embalagem', { pecas: 34 })).toBeNull();
  });

  it('os demais setores não exigem nada', () => {
    expect(erroDeConclusao('Laser', {})).toBeNull();
  });
});

describe('preço', () => {
  const camisa = { faixas: [{ aPartirDe: 1, centavos: 3600 }, { aPartirDe: 10, centavos: 3000 }], adicionais: {} };

  it('RN-07: 10 peças ou mais usa o preço menor; menos de 10 usa o maior', () => {
    expect(subtotalCentavos({ ...camisa, quantidade: 10 })).toBe(30000);
    expect(subtotalCentavos({ ...camisa, quantidade: 9 })).toBe(9 * 3600);
  });

  it('RN-09: adicionais somam ao unitário de todas as peças', () => {
    const item = { ...camisa, quantidade: 20, adicionais: { patch: true, punho: true } };
    expect(subtotalCentavos(item)).toBe(20 * (3000 + 700 + 500));
  });

  it('RN-10: o total é a soma dos subtotais', () => {
    const a = { ...camisa, quantidade: 10 };
    const b = { faixas: [{ aPartirDe: 1, centavos: 4800 }, { aPartirDe: 10, centavos: 4000 }], quantidade: 5, adicionais: { golaV: true } };
    expect(totalCentavos([a, b])).toBe(30000 + 5 * (4800 + 200));
  });
});

describe('RN-27: valores no formato brasileiro', () => {
  it.each([
    ['1.500', 150000],
    ['1.500,00', 150000],
    ['1500,5', 150050],
    ['R$ 2.920,00', 292000],
    ['70', 7000],
    ['0,50', 50],
  ])('lê %s', (texto, centavos) => {
    expect(lerValorEmCentavos(texto)).toBe(centavos);
  });

  it.each(['', 'abc', '1,2,3', '12..5', '-5'])('recusa %j', (texto) => {
    expect(lerValorEmCentavos(texto)).toBeNull();
  });
});

describe('rota completa e progresso (RF-07)', () => {
  it('Cliente sem bordado: 7 setores e o Financeiro', () => {
    expect(rotaDoPedido({ tipo: 'Cliente', bordado: false })).toEqual([
      'Design', 'Impressão', 'Batida', 'Laser', 'Conferência', 'Costura', 'Embalagem', 'Financeiro', 'Concluído',
    ]);
  });
  it('Cliente com bordado inclui o Bordado; Feira não tem Financeiro', () => {
    expect(rotaDoPedido({ tipo: 'Cliente', bordado: true })).toContain('Bordado');
    expect(rotaDoPedido({ tipo: 'Feira', bordado: false })).not.toContain('Financeiro');
    expect(rotaDoPedido({ tipo: 'Feira', bordado: false }).at(-1)).toBe('Concluído');
  });
  it('progresso: quantas etapas já passou e quantas tem', () => {
    expect(progressoDoPedido({ etapa: 'Design', tipo: 'Cliente', bordado: false })).toEqual({ feitas: 0, total: 8 });
    expect(progressoDoPedido({ etapa: 'Costura', tipo: 'Cliente', bordado: false })).toEqual({ feitas: 5, total: 8 });
    expect(progressoDoPedido({ etapa: 'Costura', tipo: 'Cliente', bordado: true })).toEqual({ feitas: 6, total: 9 });
    expect(progressoDoPedido({ etapa: 'Embalagem', tipo: 'Feira', bordado: false })).toEqual({ feitas: 6, total: 7 });
    expect(progressoDoPedido({ etapa: 'Financeiro', tipo: 'Cliente', bordado: false })).toEqual({ feitas: 7, total: 8 });
    expect(progressoDoPedido({ etapa: 'Concluído', tipo: 'Feira', bordado: false })).toEqual({ feitas: 7, total: 7 });
  });
});

describe('atraso e entregas da semana (RF-05, RF-19)', () => {
  it('atrasado só depois da data; hoje não é atraso', () => {
    expect(estaAtrasado('2026-10-20', '2026-10-21')).toBe(true);
    expect(estaAtrasado('2026-10-21', '2026-10-21')).toBe(false);
    expect(estaAtrasado('2026-10-22', '2026-10-21')).toBe(false);
  });
  it('próximos 7 dias = hoje até hoje + 6', () => {
    const f = (e: string) => entregaNosProximosDias(e, 7, '2026-10-21');
    expect(f('2026-10-20')).toBe(false);
    expect(f('2026-10-21')).toBe(true);
    expect(f('2026-10-27')).toBe(true);
    expect(f('2026-10-28')).toBe(false);
  });
});

describe('RN-33 e RN-34: prazo no horário de Fortaleza', () => {
  it('às 22h de Fortaleza ainda é o mesmo dia (01:00 UTC do dia seguinte)', () => {
    expect(diaEmFortaleza(new Date('2026-10-22T01:00:00Z'))).toBe('2026-10-21');
  });

  it('às 00:30 de Fortaleza já é o dia seguinte', () => {
    expect(diaEmFortaleza(new Date('2026-10-22T03:30:00Z'))).toBe('2026-10-22');
  });

  it('semáforo', () => {
    const hoje = '2026-10-21';
    expect(semaforoDoPrazo('2026-10-20', hoje)).toEqual({ cor: 'vermelho', texto: 'Atrasado 1 dia' });
    expect(semaforoDoPrazo('2026-10-21', hoje).cor).toBe('ambar');
    expect(semaforoDoPrazo('2026-10-22', hoje).texto).toBe('Entrega amanhã');
    expect(semaforoDoPrazo('2026-10-23', hoje).cor).toBe('ambar');
    expect(semaforoDoPrazo('2026-10-24', hoje)).toEqual({ cor: 'verde', texto: 'Faltam 3 dias' });
  });
});
