import { describe, expect, it } from 'vitest';
import { SETORES, compararFila, montarQuadro, type LoteDoQuadro } from './index';

const HOJE = '2026-10-26';
let n = 0;
function lote(campos: Partial<LoteDoQuadro> & { etapa: string }): LoteDoQuadro {
  n += 1;
  return {
    id: `id-${n}`,
    numero: n,
    tipo: 'Cliente',
    descricao: `Pedido ${n}`,
    quantidade: 10,
    prioridade: 'Normal',
    dataEntrega: '2026-11-10',
    recuperacaoPendente: false,
    devolvidoPor: null,
    motivoRecuperacao: null,
    ...campos,
  };
}
const montar = (lotes: LoteDoQuadro[], extra = {}) =>
  montarQuadro({ lotes, hoje: HOJE, agora: '2026-10-26T15:00:00.000Z', pecasFinalizadasHoje: 0, aReceberCentavos: 0, recebidoMesCentavos: 0, ...extra });

describe('ordem da fila (RN-35)', () => {
  it('prioridade, depois data de entrega, depois número', () => {
    const a = { prioridade: 'Normal', dataEntrega: '2026-11-01', numero: 1 };
    const b = { prioridade: 'Urgente', dataEntrega: '2026-11-20', numero: 2 };
    const c = { prioridade: 'Normal', dataEntrega: '2026-11-01', numero: 3 };
    const d = { prioridade: 'Alta', dataEntrega: '2026-11-05', numero: 4 };
    expect([a, b, c, d].sort(compararFila).map((x) => x.numero)).toEqual([2, 4, 1, 3]);
  });
});

describe('quadro da Direção', () => {
  it('tem uma coluna por setor, mais Financeiro e entrega e Concluídos hoje, nessa ordem', () => {
    const q = montar([]);
    expect(q.colunas.map((c) => c.chave)).toEqual([...SETORES, 'Financeiro', 'Concluído']);
    expect(q.colunas.at(-1)!.nome).toBe('Concluídos hoje');
    expect(q.colunas.find((c) => c.chave === 'Financeiro')!.nome).toBe('Financeiro e entrega');
    expect(q.colunas.every((c) => c.pedidos.length === 0 && c.pecas === 0)).toBe(true);
  });

  it('coloca cada pedido na coluna da sua etapa, com a soma de peças, ordenado pela fila', () => {
    const q = montar([
      lote({ etapa: 'Laser', quantidade: 20, prioridade: 'Normal', numero: 10 }),
      lote({ etapa: 'Laser', quantidade: 5, prioridade: 'Urgente', numero: 11 }),
      lote({ etapa: 'Costura', quantidade: 8 }),
      lote({ etapa: 'Financeiro', quantidade: 30 }),
    ]);
    const laser = q.colunas.find((c) => c.chave === 'Laser')!;
    expect(laser.pedidos.map((p) => p.numero)).toEqual([11, 10]);
    expect(laser.pecas).toBe(25);
    expect(q.colunas.find((c) => c.chave === 'Costura')!.pecas).toBe(8);
    expect(q.colunas.find((c) => c.chave === 'Financeiro')!.pecas).toBe(30);
  });

  it('"em produção" conta só os setores de produção, não o Financeiro', () => {
    const q = montar([lote({ etapa: 'Design', quantidade: 10 }), lote({ etapa: 'Embalagem', quantidade: 6 }), lote({ etapa: 'Financeiro', quantidade: 99 })]);
    expect(q.emProducaoPedidos).toBe(2);
    expect(q.emProducaoPecas).toBe(16);
  });

  it('atrasados e urgentes contam só o que está em aberto; concluído nunca atrasa', () => {
    const q = montar([
      lote({ etapa: 'Costura', dataEntrega: '2026-10-25', prioridade: 'Urgente' }),
      lote({ etapa: 'Financeiro', dataEntrega: '2026-10-20' }),
      lote({ etapa: 'Costura', dataEntrega: HOJE }),
      lote({ etapa: 'Concluído', dataEntrega: '2026-10-01', prioridade: 'Urgente' }),
    ]);
    expect(q.atrasados).toBe(2);
    expect(q.urgentes).toBe(1);
  });

  it('Concluídos hoje traz só o que a API mandou como concluído, e não entra nos indicadores em aberto', () => {
    const q = montar([lote({ etapa: 'Concluído', quantidade: 12 }), lote({ etapa: 'Laser', quantidade: 4 })]);
    const concluidos = q.colunas.find((c) => c.chave === 'Concluído')!;
    expect(concluidos.pedidos).toHaveLength(1);
    expect(concluidos.pecas).toBe(12);
    expect(q.emProducaoPedidos).toBe(1);
  });

  it('"Atenção" lista atrasados e recuperações, e um pedido nas duas condições aparece duas vezes', () => {
    const q = montar([
      lote({ etapa: 'Impressão', dataEntrega: '2026-10-24' }),
      lote({ etapa: 'Design', recuperacaoPendente: true, devolvidoPor: 'Laser', motivoRecuperacao: 'Falha na sublimação', numero: 77 }),
      lote({ etapa: 'Design', dataEntrega: '2026-10-20', recuperacaoPendente: true, devolvidoPor: 'Conferência', motivoRecuperacao: 'Cor errada', numero: 78 }),
      lote({ etapa: 'Costura' }),
    ]);
    expect(q.atencao.map((a) => [a.numero, a.tipo])).toEqual([
      [78, 'atraso'], // entrega em 20/10, a mais antiga
      [expect.any(Number), 'atraso'],
      [78, 'recuperacao'],
      [77, 'recuperacao'],
    ]);
    const rec = q.atencao.find((a) => a.numero === 77 && a.tipo === 'recuperacao')!;
    expect(rec).toMatchObject({ devolvidoPor: 'Laser', motivo: 'Falha na sublimação' });
  });

  it('repassa os totais do que não vem dos pedidos (peças finalizadas, a receber, recebido no mês)', () => {
    const q = montar([], { pecasFinalizadasHoje: 48, aReceberCentavos: 125_000, recebidoMesCentavos: 800_000 });
    expect(q).toMatchObject({ pecasFinalizadasHoje: 48, aReceberCentavos: 125_000, recebidoMesCentavos: 800_000, geradoEm: '2026-10-26T15:00:00.000Z' });
  });
});
