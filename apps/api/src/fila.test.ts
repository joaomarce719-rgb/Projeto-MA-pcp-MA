import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

type Fila = { lotes: { descricao: string; etapa: string; numero: number }[] };
const filaDe = async (quem: string, caminho = '/fila') => (await (await amb.chamar(quem, caminho)).json()) as Fila;
const nomes = (f: Fila) => f.lotes.map((l) => l.descricao);

async function concluido(descricao: string, finalizadoEm: string) {
  const id = await amb.lote({ descricao, etapa: 'Concluído' });
  await amb.pg.query('update lotes set finalizado_em = $2 where id = $1', [id, finalizadoEm]);
  return id;
}

describe('aba Concluídos (RF-06)', () => {
  it('lista os concluídos do mais recente ao mais antigo, e não os em andamento', async () => {
    await concluido('antigo', '2026-10-01T12:00:00Z');
    await concluido('recente', '2026-10-20T12:00:00Z');
    await concluido('meio', '2026-10-10T12:00:00Z');
    await amb.lote({ descricao: 'em produção', etapa: 'Costura' });

    expect(nomes(await filaDe(ID.atendimento, '/fila?aba=concluidos'))).toEqual(['recente', 'meio', 'antigo']);
    expect(nomes(await filaDe(ID.atendimento))).toEqual(['em produção']);
  });

  it('atendimento, direção e admin acessam; setor recebe 403', async () => {
    await concluido('a', '2026-10-01T12:00:00Z');
    for (const quem of [ID.atendimento, ID.direcao, ID.admin]) {
      expect((await amb.chamar(quem, '/fila?aba=concluidos')).status).toBe(200);
    }
    for (const quem of [ID.impressao]) {
      const r = await amb.chamar(quem, '/fila?aba=concluidos');
      expect(r.status).toBe(403);
      expect(await r.text()).not.toContain('"a"');
    }
  });

  it('mostra só os 50 mais recentes', async () => {
    for (let i = 1; i <= 52; i++) await concluido(`p${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`);
    const { lotes } = await filaDe(ID.atendimento, '/fila?aba=concluidos');
    expect(lotes).toHaveLength(50);
  });

  it('um pedido que ficou sem data de fim não quebra a lista e vai para o fim', async () => {
    await concluido('com data', '2026-10-01T12:00:00Z');
    await amb.lote({ descricao: 'sem data', etapa: 'Concluído' });
    expect(nomes(await filaDe(ID.atendimento, '/fila?aba=concluidos'))).toEqual(['com data', 'sem data']);
  });

  it('aba desconhecida: 400', async () => {
    expect((await amb.chamar(ID.atendimento, '/fila?aba=qualquer')).status).toBe(400);
  });

  it('o padrão continua sendo "em andamento"', async () => {
    await concluido('fim', '2026-10-01T12:00:00Z');
    await amb.lote({ descricao: 'aberto', etapa: 'Design' });
    expect(nomes(await filaDe(ID.atendimento, '/fila?aba=andamento'))).toEqual(['aberto']);
    expect(nomes(await filaDe(ID.atendimento))).toEqual(['aberto']);
  });
});

describe('o número do pedido chega como número (RF-07)', () => {
  it('numero é number na fila', async () => {
    await amb.lote({ descricao: 'a', etapa: 'Design' });
    const { lotes } = await filaDe(ID.atendimento);
    expect(typeof lotes[0]!.numero).toBe('number');
  });
});
