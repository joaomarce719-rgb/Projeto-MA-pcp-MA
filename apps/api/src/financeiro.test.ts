import { diaEmFortaleza, somarDias, type FinanceiroResposta } from '@pcp/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

async function json<T = Record<string, unknown>>(r: Response | Promise<Response>): Promise<T> {
  return (await r).json() as Promise<T>;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n');

/** Um pedido de Cliente já na etapa Financeiro, com valor de R$ 1.000,00 (100.000 centavos). */
async function pedidoNoFinanceiro(total = 100_000): Promise<{ id: string; versao: number }> {
  const id = await amb.lote({ descricao: 'Clube Exemplo', etapa: 'Financeiro', total });
  const { rows } = await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [id]);
  return { id, versao: rows[0]!.versao };
}

const receber = (quem: string | null, id: string, corpo: object) => amb.chamar(quem, `/lotes/${id}/recebimentos`, corpo);
const entregar = (quem: string | null, id: string, versao: number) => amb.chamar(quem, `/lotes/${id}/entregar`, { versao });
const financeiro = (quem: string | null) => json<FinanceiroResposta & { erro?: string }>(amb.chamar(quem, '/financeiro'));

function enviarComprovante(quem: string | null, recebimentoId: string, bytes: Uint8Array, nome?: string) {
  const headers: Record<string, string> = {};
  if (quem) headers.Authorization = `Bearer ${quem}`;
  if (nome) headers['X-Nome'] = encodeURIComponent(nome);
  return amb.fetch(new Request(`http://api.local/recebimentos/${recebimentoId}/comprovante`, { method: 'POST', headers, body: bytes }));
}

describe('novo pedido com entrada (RN-24)', () => {
  // 10 camisas adultas dry fit: faixa de 10 peças ou mais, R$ 35,00 cada = 35.000 centavos.
  const pedido = (extra: object) => ({
    tipo: 'Cliente',
    dataEntrega: somarDias(diaEmFortaleza(), 10),
    itens: [{ produto: 'CAMISA ADULTO MALHA DRY FIT', modo: 'adulto', grade: { M: 10 } }],
    ...extra,
  });
  async function cliente() {
    const r = await amb.chamar(ID.atendimento, '/clientes', { nome: 'Clube Exemplo' });
    return (await json<{ cliente: { id: string } }>(r)).cliente.id;
  }

  it('grava a entrada junto com o pedido (o total vem do catálogo) e devolve o id da entrada', async () => {
    const clienteId = await cliente();
    const r = await amb.chamar(ID.atendimento, '/pedidos', pedido({ clienteId, entrada: { valorCentavos: 17_500, forma: 'Pix' } }));
    expect(r.status).toBe(201);
    const { id, entradaId, totalCentavos } = await json<{ id: string; entradaId: string; totalCentavos: number }>(r);
    expect(entradaId).toBeTruthy();
    expect(totalCentavos).toBe(35_000);
    const { rows } = await amb.pg.query('select r.valor_centavos, r.forma, r.momento, l.total_centavos from recebimentos r join lotes l on l.id = r.lote_id where l.id = $1', [id]);
    expect(rows).toEqual([{ valor_centavos: 17_500, forma: 'Pix', momento: 'Entrada', total_centavos: 35_000 }]);
  });

  it('sem entrada, não grava recebimento (campo vazio quer dizer que não houve)', async () => {
    const clienteId = await cliente();
    const r = await amb.chamar(ID.atendimento, '/pedidos', pedido({ clienteId }));
    expect(r.status).toBe(201);
    expect((await json<{ entradaId: string | null }>(r)).entradaId).toBeNull();
    expect((await amb.pg.query('select 1 from recebimentos')).rows).toHaveLength(0);
  });

  it('recusa entrada maior que o total calculado e entrada sem forma de pagamento, sem criar o pedido', async () => {
    const clienteId = await cliente();
    const maior = await amb.chamar(ID.atendimento, '/pedidos', pedido({ clienteId, entrada: { valorCentavos: 35_001, forma: 'Pix' } }));
    expect(maior.status).toBe(400);
    expect((await json<{ erro: string }>(maior)).erro).toMatch(/saldo de R\$\s?350,00/);
    const semForma = await amb.chamar(ID.atendimento, '/pedidos', pedido({ clienteId, entrada: { valorCentavos: 500 } }));
    expect(semForma.status).toBe(400);
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(0);
  });
});

describe('GET /financeiro (RF-25 e RF-26)', () => {
  it('lista só pedidos de Cliente no Financeiro, com total, recebido, saldo e percentual', async () => {
    const { id } = await pedidoNoFinanceiro(100_000);
    await amb.lote({ descricao: 'Em produção', etapa: 'Costura', total: 50_000 });
    await amb.lote({ descricao: 'Feira', etapa: 'Concluído', tipo: 'Feira' });
    await amb.pg.query(`insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por) values ($1, 30000, 'Pix', 'Entrada', $2)`, [id, ID.atendimento]);

    const r = await financeiro(ID.atendimento);
    expect(r.pedidos).toHaveLength(1);
    expect(r.pedidos[0]).toMatchObject({ descricao: 'Clube Exemplo', totalCentavos: 100_000, recebidoCentavos: 30_000, saldoCentavos: 70_000, percentualPago: 30 });
    expect(r.pedidos[0]!.recebimentos).toMatchObject([{ valorCentavos: 30_000, forma: 'Pix', momento: 'Entrada', por: 'Atendimento', temComprovante: false }]);
  });

  it('soma o recebido no dia, nos 7 dias e no mês, e o total a receber (inclui pedidos em produção)', async () => {
    const { id } = await pedidoNoFinanceiro(100_000);
    const emProducao = await amb.lote({ descricao: 'Em produção', etapa: 'Costura', total: 50_000 });
    const dias = (n: number) => `now() - interval '${n} days'`;
    for (const [lote, valor, quando] of [
      [id, 10_000, 'now()'],
      [id, 20_000, dias(3)],
      [id, 40_000, dias(40)],
      [emProducao, 5_000, 'now()'],
    ] as const) {
      await amb.pg.query(
        `insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por, criado_em) values ($1, $2, 'Pix', 'Financeiro', $3, ${quando})`,
        [lote, valor, ID.atendimento],
      );
    }
    const { resumo } = await financeiro(ID.atendimento);
    expect(resumo.recebidoHojeCentavos).toBe(15_000);
    expect(resumo.recebido7DiasCentavos).toBe(35_000);
    // O mês pode começar depois de "3 dias atrás" (primeiros dias do mês): o piso é o de hoje, o teto é o dos 7 dias + 40.
    expect(resumo.recebidoMesCentavos).toBeGreaterThanOrEqual(15_000);
    expect(resumo.recebidoMesCentavos).toBeLessThanOrEqual(75_000);
    // A receber: (100.000 − 70.000) + (50.000 − 5.000)
    expect(resumo.aReceberCentavos).toBe(75_000);
  });

  it('atendimento, direção e admin veem; setor e quem não tem login não', async () => {
    await pedidoNoFinanceiro();
    expect((await amb.chamar(ID.atendimento, '/financeiro')).status).toBe(200);
    expect((await amb.chamar(ID.admin, '/financeiro')).status).toBe(200);
    expect((await amb.chamar(ID.direcao, '/financeiro')).status).toBe(200);
    expect((await amb.chamar(ID.costura, '/financeiro')).status).toBe(403);
    expect((await amb.chamar(null, '/financeiro')).status).toBe(401);
  });
});

describe('POST /lotes/:id/recebimentos (RF-27)', () => {
  it('registra dentro do saldo, soma ao recebido e sobe a versão', async () => {
    const { id, versao } = await pedidoNoFinanceiro(100_000);
    const r = await receber(ID.atendimento, id, { versao, valorCentavos: 40_000, forma: 'Dinheiro' });
    expect(r.status).toBe(201);
    expect(await json(r)).toMatchObject({ versao: versao + 1, saldoCentavos: 60_000 });
    const lista = await financeiro(ID.atendimento);
    expect(lista.pedidos[0]).toMatchObject({ recebidoCentavos: 40_000, saldoCentavos: 60_000, percentualPago: 40, versao: versao + 1 });
    expect(lista.pedidos[0]!.recebimentos[0]).toMatchObject({ momento: 'Financeiro', forma: 'Dinheiro' });
  });

  it('recusa valor acima do saldo (RN-25), sem gravar nada', async () => {
    const { id, versao } = await pedidoNoFinanceiro(100_000);
    const r = await receber(ID.atendimento, id, { versao, valorCentavos: 100_001, forma: 'Pix' });
    expect(r.status).toBe(400);
    expect((await json<{ erro: string }>(r)).erro).toMatch(/saldo de R\$\s?1\.000,00/);
    expect((await amb.pg.query('select 1 from recebimentos')).rows).toHaveLength(0);
  });

  it('recusa sem forma de pagamento (RN-26), valor zero e valor quebrado', async () => {
    const { id, versao } = await pedidoNoFinanceiro();
    expect((await receber(ID.atendimento, id, { versao, valorCentavos: 100 })).status).toBe(400);
    expect((await receber(ID.atendimento, id, { versao, valorCentavos: 0, forma: 'Pix' })).status).toBe(400);
    expect((await receber(ID.atendimento, id, { versao, valorCentavos: 10.5, forma: 'Pix' })).status).toBe(400);
  });

  it('um clique repetido não lança duas vezes: a segunda tentativa recebe 409 (RNF-04)', async () => {
    const { id, versao } = await pedidoNoFinanceiro();
    const corpo = { versao, valorCentavos: 10_000, forma: 'Pix' };
    expect((await receber(ID.atendimento, id, corpo)).status).toBe(201);
    expect((await receber(ID.atendimento, id, corpo)).status).toBe(409);
    expect((await amb.pg.query('select 1 from recebimentos')).rows).toHaveLength(1);
  });

  it('só com o pedido em Financeiro e entrega (RN-29), e só de Cliente', async () => {
    const emProducao = await amb.lote({ descricao: 'Em produção', etapa: 'Costura', total: 10_000 });
    expect((await receber(ID.atendimento, emProducao, { versao: 1, valorCentavos: 100, forma: 'Pix' })).status).toBe(409);
    const concluido = await amb.lote({ descricao: 'Concluído', etapa: 'Concluído', total: 10_000 });
    expect((await receber(ID.atendimento, concluido, { versao: 1, valorCentavos: 100, forma: 'Pix' })).status).toBe(409);
  });

  it('atendimento, direção e admin registram; setor e sem login não', async () => {
    const { id, versao } = await pedidoNoFinanceiro();
    const corpo = { versao, valorCentavos: 100, forma: 'Pix' };
    expect((await receber(ID.costura, id, corpo)).status).toBe(403);
    expect((await receber(null, id, corpo)).status).toBe(401);
    expect((await receber(ID.direcao, id, corpo)).status).toBe(201);
    expect((await receber(ID.admin, id, { ...corpo, versao: versao + 1 })).status).toBe(201);
  });

  it('pedido inexistente: 404; identificador malformado: 400', async () => {
    const corpo = { versao: 1, valorCentavos: 100, forma: 'Pix' };
    expect((await receber(ID.atendimento, '11111111-1111-4111-8111-111111111111', corpo)).status).toBe(404);
    expect((await receber(ID.atendimento, 'nao-e-id', corpo)).status).toBe(400);
  });
});

describe('POST /lotes/:id/entregar (RF-28 e RN-30)', () => {
  it('recusa com saldo, dizendo quanto falta, e o pedido continua no Financeiro', async () => {
    const { id, versao } = await pedidoNoFinanceiro(100_000);
    const r = await entregar(ID.atendimento, id, versao);
    expect(r.status).toBe(400);
    expect((await json<{ erro: string }>(r)).erro).toMatch(/saldo de R\$\s?1\.000,00/);
    expect((await amb.pg.query('select etapa from lotes where id = $1', [id])).rows).toEqual([{ etapa: 'Financeiro' }]);
  });

  it('com saldo zero, conclui o pedido e grava a finalização no histórico', async () => {
    const { id, versao } = await pedidoNoFinanceiro(100_000);
    const pago = await receber(ID.atendimento, id, { versao, valorCentavos: 100_000, forma: 'Pix' });
    const novaVersao = (await json<{ versao: number }>(pago)).versao;

    const r = await entregar(ID.atendimento, id, novaVersao);
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ etapa: 'Concluído' });
    const { rows } = await amb.pg.query('select etapa, finalizado_em is not null as fim from lotes where id = $1', [id]);
    expect(rows).toEqual([{ etapa: 'Concluído', fim: true }]);
    const historico = await amb.pg.query('select etapa, tipo, nota from historico where lote_id = $1', [id]);
    expect(historico.rows).toEqual([{ etapa: 'Financeiro', tipo: 'Finalização', nota: 'Entrega confirmada.' }]);
    expect((await financeiro(ID.atendimento)).pedidos).toHaveLength(0);
  });

  it('pedido sem valor (antigo) pode ser entregue direto', async () => {
    const { id, versao } = await pedidoNoFinanceiro(0);
    expect((await entregar(ID.atendimento, id, versao)).status).toBe(200);
  });

  it('versão velha ou segunda confirmação: 409; setor: 403; a direção confirma', async () => {
    const { id, versao } = await pedidoNoFinanceiro(0);
    expect((await entregar(ID.costura, id, versao)).status).toBe(403);
    expect((await entregar(ID.atendimento, id, versao + 5)).status).toBe(409);
    expect((await entregar(ID.direcao, id, versao)).status).toBe(200);
    expect((await entregar(ID.atendimento, id, versao)).status).toBe(409);
  });
});

describe('comprovante do recebimento (RN-31)', () => {
  async function umRecebimento(): Promise<string> {
    const { id, versao } = await pedidoNoFinanceiro();
    const r = await receber(ID.atendimento, id, { versao, valorCentavos: 10_000, forma: 'Pix' });
    return (await json<{ id: string }>(r)).id;
  }

  it('guarda imagem ou PDF, marca o recebimento e devolve o arquivo a quem cuida do financeiro', async () => {
    const rec = await umRecebimento();
    expect((await enviarComprovante(ID.atendimento, rec, PDF, 'pix.pdf')).status).toBe(201);
    expect((await financeiro(ID.atendimento)).pedidos[0]!.recebimentos[0]!.temComprovante).toBe(true);

    const aberto = await amb.chamar(ID.admin, `/recebimentos/${rec}/comprovante`);
    expect(aberto.status).toBe(200);
    expect(aberto.headers.get('Content-Type')).toBe('application/pdf');
    expect(aberto.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await aberto.arrayBuffer())).toEqual(PDF);
  });

  it('descobre o tipo pelos bytes: um executável com cara de imagem é recusado', async () => {
    const rec = await umRecebimento();
    expect((await enviarComprovante(ID.atendimento, rec, new TextEncoder().encode('MZ programa'))).status).toBe(415);
    expect((await enviarComprovante(ID.atendimento, rec, new Uint8Array([]))).status).toBe(400);
    expect((await amb.pg.query('select comprovante_chave from recebimentos')).rows).toEqual([{ comprovante_chave: null }]);
  });

  it('não troca o comprovante de um recebimento (RN-32)', async () => {
    const rec = await umRecebimento();
    expect((await enviarComprovante(ID.atendimento, rec, JPEG)).status).toBe(201);
    expect((await enviarComprovante(ID.atendimento, rec, PDF)).status).toBe(409);
  });

  it('se o armazenamento falhar, nada fica gravado', async () => {
    const rec = await umRecebimento();
    amb.simularFalhaNoArmazenamento(true);
    expect((await enviarComprovante(ID.atendimento, rec, JPEG)).status).toBe(500);
    amb.simularFalhaNoArmazenamento(false);
    expect((await amb.pg.query('select comprovante_chave from recebimentos')).rows).toEqual([{ comprovante_chave: null }]);
    expect((await enviarComprovante(ID.atendimento, rec, JPEG)).status).toBe(201);
  });

  it('setor e sem login não enviam nem abrem; a direção envia e abre', async () => {
    const rec = await umRecebimento();
    expect((await enviarComprovante(ID.costura, rec, JPEG)).status).toBe(403);
    expect((await enviarComprovante(null, rec, JPEG)).status).toBe(401);
    expect((await enviarComprovante(ID.direcao, rec, JPEG)).status).toBe(201);
    expect((await amb.chamar(ID.costura, `/recebimentos/${rec}/comprovante`)).status).toBe(403);
    expect((await amb.chamar(ID.direcao, `/recebimentos/${rec}/comprovante`)).status).toBe(200);
    expect((await amb.chamar(null, `/recebimentos/${rec}/comprovante`)).status).toBe(401);
  });

  it('recebimento sem comprovante ou inexistente: 404', async () => {
    const rec = await umRecebimento();
    expect((await amb.chamar(ID.atendimento, `/recebimentos/${rec}/comprovante`)).status).toBe(404);
    expect((await amb.chamar(ID.atendimento, '/recebimentos/11111111-1111-4111-8111-111111111111/comprovante')).status).toBe(404);
  });
});

describe('valores na ficha e na fila', () => {
  async function comEntrada() {
    const { id } = await pedidoNoFinanceiro(100_000);
    await amb.pg.query(`insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por) values ($1, 25000, 'Pix', 'Entrada', $2)`, [id, ID.atendimento]);
    return id;
  }
  type FichaComValores = { valores?: { totalCentavos: number; recebidoCentavos: number; saldoCentavos: number; percentualPago: number; recebimentos: { forma: string; por: string }[] } };

  it('a ficha de Cliente traz total, recebido, saldo e recebimentos para atendimento, direção e admin', async () => {
    const id = await comEntrada();
    for (const quem of [ID.atendimento, ID.direcao, ID.admin]) {
      const ficha = await json<FichaComValores>(amb.chamar(quem, `/lotes/${id}`));
      expect(ficha.valores).toMatchObject({ totalCentavos: 100_000, recebidoCentavos: 25_000, saldoCentavos: 75_000, percentualPago: 25 });
      expect(ficha.valores!.recebimentos).toMatchObject([{ forma: 'Pix', por: 'Atendimento' }]);
    }
  });

  it('pedido de Feira não tem bloco de valores', async () => {
    const id = await amb.lote({ descricao: 'Feira', etapa: 'Costura', tipo: 'Feira' });
    expect((await json<FichaComValores>(amb.chamar(ID.atendimento, `/lotes/${id}`))).valores).toBeUndefined();
  });

  it('a fila do atendimento traz total e recebido; a do setor não traz nenhuma coluna de valor', async () => {
    const id = await comEntrada();
    await amb.pg.query(`update lotes set etapa = 'Costura' where id = $1`, [id]);
    const doAtendimento = await json<{ lotes: { totalCentavos?: number; recebidoCentavos?: number }[] }>(amb.chamar(ID.atendimento, '/fila'));
    expect(doAtendimento.lotes[0]).toMatchObject({ totalCentavos: 100_000, recebidoCentavos: 25_000 });
    const doSetor = await json<{ lotes: Record<string, unknown>[] }>(amb.chamar(ID.costura, '/fila'));
    expect(doSetor.lotes).toHaveLength(1);
    expect(Object.keys(doSetor.lotes[0]!)).not.toEqual(expect.arrayContaining(['totalCentavos']));
    expect(JSON.stringify(doSetor)).not.toMatch(/centavos/i);
  });
});

describe('o setor nunca recebe valores (RF-02)', () => {
  it('a ficha e a fila do setor não trazem total, recebido nem recebimentos', async () => {
    const { id } = await pedidoNoFinanceiro(100_000);
    await amb.pg.query('update lotes set etapa = $1 where id = $2', ['Costura', id]);
    await amb.pg.query(`insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por) values ($1, 30000, 'Pix', 'Entrada', $2)`, [id, ID.atendimento]);
    const ficha = JSON.stringify(await json(amb.chamar(ID.costura, `/lotes/${id}`)));
    const fila = JSON.stringify(await json(amb.chamar(ID.costura, '/fila')));
    for (const texto of [ficha, fila]) expect(texto).not.toMatch(/total|recebi|centavos|saldo|forma/i);
  });
});
