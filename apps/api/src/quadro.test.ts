import { diaEmFortaleza, somarDias, type QuadroResposta } from '@pcp/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

const quadroDe = (quem: string | null) => amb.chamar(quem, '/quadro');
const quadro = async (quem: string = ID.direcao) => (await (await quadroDe(quem)).json()) as QuadroResposta;
const coluna = (q: QuadroResposta, chave: string) => q.colunas.find((c) => c.chave === chave)!;

describe('GET /quadro: permissões (RF-02)', () => {
  it('direção e admin veem; atendimento, setor e sem login não', async () => {
    expect((await quadroDe(ID.direcao)).status).toBe(200);
    expect((await quadroDe(ID.admin)).status).toBe(200);
    for (const quem of [ID.atendimento, ID.costura, ID.impressao]) expect((await quadroDe(quem)).status).toBe(403);
    expect((await quadroDe(null)).status).toBe(401);
  });

  it('é só leitura: não existe escrita no quadro', async () => {
    const r = await amb.chamar(ID.direcao, '/quadro', {});
    expect(r.status).not.toBe(200);
  });
});

describe('GET /quadro: conteúdo', () => {
  it('com o banco vazio, devolve as 10 colunas e zeros', async () => {
    const q = await quadro();
    expect(q.colunas).toHaveLength(10);
    expect(q).toMatchObject({ emProducaoPedidos: 0, atrasados: 0, urgentes: 0, pecasFinalizadasHoje: 0, aReceberCentavos: 0, recebidoMesCentavos: 0, atencao: [] });
  });

  it('distribui os pedidos pelas colunas e conta peças, atrasados e urgentes', async () => {
    await amb.lote({ descricao: 'No laser', etapa: 'Laser', prioridade: 'Urgente', entrega: somarDias(diaEmFortaleza(), 2) });
    await amb.lote({ descricao: 'Atrasado', etapa: 'Costura', entrega: somarDias(diaEmFortaleza(), -3) });
    await amb.lote({ descricao: 'Cobrança', etapa: 'Financeiro', total: 100_000 });
    await amb.lote({ descricao: 'Feira pronta', etapa: 'Concluído', tipo: 'Feira' });

    const q = await quadro();
    expect(coluna(q, 'Laser').pedidos.map((p) => p.descricao)).toEqual(['No laser']);
    expect(coluna(q, 'Costura').pecas).toBe(20);
    expect(coluna(q, 'Financeiro').pedidos).toHaveLength(1);
    expect(q.emProducaoPedidos).toBe(2);
    expect(q.emProducaoPecas).toBe(40);
    expect(q.urgentes).toBe(1);
    expect(q.atrasados).toBe(1);
    expect(q.atencao.map((a) => [a.descricao, a.tipo])).toEqual([['Atrasado', 'atraso']]);
  });

  it('Concluídos hoje traz só o que terminou hoje, no horário de Fortaleza', async () => {
    const hoje = await amb.lote({ descricao: 'Terminou hoje', etapa: 'Concluído' });
    const ontem = await amb.lote({ descricao: 'Terminou há 3 dias', etapa: 'Concluído' });
    const semData = await amb.lote({ descricao: 'Antigo sem data', etapa: 'Concluído' });
    await amb.pg.query('update lotes set finalizado_em = now() where id = $1', [hoje]);
    await amb.pg.query(`update lotes set finalizado_em = now() - interval '3 days' where id = $1`, [ontem]);
    expect(semData).toBeTruthy();

    const q = await quadro();
    expect(coluna(q, 'Concluído').pedidos.map((p) => p.descricao)).toEqual(['Terminou hoje']);
  });

  it('peças finalizadas hoje somam o que a Embalagem informou hoje, de Cliente e de Feira (RN-36)', async () => {
    const a = await amb.lote({ descricao: 'A', etapa: 'Financeiro' });
    const b = await amb.lote({ descricao: 'B', etapa: 'Concluído', tipo: 'Feira' });
    const velho = await amb.lote({ descricao: 'C', etapa: 'Financeiro' });
    const linha = (lote: string, pecas: number, quando: string, etapa = 'Embalagem') =>
      amb.pg.query(`insert into historico (lote_id, etapa, tipo, pecas, usuario_id, criado_em) values ($1, $2, 'Conclusão', $3, $4, ${quando})`, [lote, etapa, pecas, ID.costura]);
    await linha(a, 18, 'now()');
    await linha(b, 30, 'now()');
    await linha(velho, 99, `now() - interval '2 days'`);
    await linha(a, 77, 'now()', 'Costura'); // outra etapa não conta

    expect((await quadro()).pecasFinalizadasHoje).toBe(48);
  });

  it('mostra quem devolveu e o motivo na recuperação', async () => {
    const id = await amb.lote({ descricao: 'Devolvido', etapa: 'Design', recuperacao: true });
    await amb.pg.query(`insert into historico (lote_id, etapa, tipo, nota, usuario_id) values ($1, 'Laser', 'Recuperação', '3 peças com falha', $2)`, [id, ID.laser]);

    const q = await quadro();
    expect(q.atencao).toMatchObject([{ tipo: 'recuperacao', descricao: 'Devolvido', devolvidoPor: 'Laser', motivo: '3 peças com falha' }]);
    expect(coluna(q, 'Design').pedidos[0]!.recuperacaoPendente).toBe(true);
  });

  it('traz o a receber e o recebido no mês, em centavos', async () => {
    const id = await amb.lote({ descricao: 'Cobrança', etapa: 'Financeiro', total: 100_000 });
    await amb.pg.query(`insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por) values ($1, 30000, 'Pix', 'Entrada', $2)`, [id, ID.atendimento]);
    const q = await quadro();
    expect(q.aReceberCentavos).toBe(70_000);
    expect(q.recebidoMesCentavos).toBe(30_000);
  });

  it('não traz documento nem telefone do cliente', async () => {
    const r = await amb.chamar(ID.atendimento, '/clientes', { nome: 'Clube Exemplo', documento: '12.345.678/0001-90', telefone: '(85) 98888-7777' });
    const { cliente } = (await r.json()) as { cliente: { id: string } };
    await amb.pg.query(`update lotes set cliente_id = $1`, [cliente.id]);
    await amb.lote({ descricao: 'Pedido do clube', etapa: 'Laser' });
    await amb.pg.query(`update lotes set cliente_id = $1`, [cliente.id]);
    const texto = JSON.stringify(await quadro());
    expect(texto).not.toMatch(/12\.345|98888/);
  });
});
