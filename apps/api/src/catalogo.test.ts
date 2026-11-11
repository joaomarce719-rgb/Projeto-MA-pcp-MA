import { diaEmFortaleza, precoDaFaixa, somarDias, type FaixaDePreco, type FichaLote, type OrcamentoDoPedido, type ProdutoDoCatalogo } from '@pcp/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
let clienteSalvo: string | null;
beforeEach(async () => {
  amb = await criarAmbiente();
  clienteSalvo = null;
});

async function json<T = Record<string, unknown>>(r: Response | Promise<Response>): Promise<T> {
  return (await r).json() as Promise<T>;
}

async function cliente(): Promise<string> {
  if (clienteSalvo) return clienteSalvo;
  const r = await amb.chamar(ID.atendimento, '/clientes', { nome: 'Clube Exemplo', documento: '12.345.678/0001-90', telefone: '(85) 98888-7777', cidade: 'Fortaleza/CE' });
  clienteSalvo = (await json<{ cliente: { id: string } }>(r)).cliente.id;
  return clienteSalvo;
}

const item = (produto: string, grade: Record<string, number>, adicionais: object = {}) => ({
  produto,
  modo: /INFANTIL/i.test(produto) ? 'infantil' : 'adulto',
  grade,
  adicionais,
});

async function abrir(itens: object[], extra: object = {}) {
  const clienteId = await cliente();
  return amb.chamar(ID.atendimento, '/pedidos', { tipo: 'Cliente', clienteId, dataEntrega: somarDias(diaEmFortaleza(), 10), itens, ...extra });
}

describe('GET /catalogo (RF-10)', () => {
  it('traz os 46 produtos ativos da migração, com preços em centavos, em ordem de nome', async () => {
    const { produtos } = await json<{ produtos: ProdutoDoCatalogo[] }>(amb.chamar(ID.atendimento, '/catalogo'));
    expect(produtos).toHaveLength(46);
    expect(produtos.map((p) => p.nome)).toEqual([...produtos.map((p) => p.nome)].sort((a, b) => a.localeCompare(b)));
    expect(produtos.find((p) => p.nome === 'CAMISA ADULTO MALHA DRY FIT')).toMatchObject({ malha: 'DRY FIT', faixas: [{ aPartirDe: 1, centavos: 4200 }, { aPartirDe: 10, centavos: 3500 }] });
    expect(produtos.every((p) => p.faixas.length > 0 && p.faixas[0]!.aPartirDe === 1 && p.faixas.every((f) => Number.isInteger(f.centavos)))).toBe(true);
  });

  it('produto desativado sai do catálogo', async () => {
    await amb.pg.query(`update produtos set ativo = false where nome = 'FAIXA DE CAPITÃO'`);
    const { produtos } = await json<{ produtos: ProdutoDoCatalogo[] }>(amb.chamar(ID.atendimento, '/catalogo'));
    expect(produtos).toHaveLength(45);
  });

  it('atendimento, direção e admin veem os preços; setor e sem login não', async () => {
    for (const quem of [ID.atendimento, ID.direcao, ID.admin]) expect((await amb.chamar(quem, '/catalogo')).status).toBe(200);
    for (const quem of [ID.costura, ID.impressao]) expect((await amb.chamar(quem, '/catalogo')).status).toBe(403);
    expect((await amb.chamar(null, '/catalogo')).status).toBe(401);
  });
});

describe('preço do pedido, calculado no servidor (RN-07 a RN-10)', () => {
  it('10 peças pagam a faixa de 10 ou mais; 9 peças pagam a de menos de 10', async () => {
    const dez = await json<{ totalCentavos: number }>(await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })]));
    expect(dez.totalCentavos).toBe(10 * 3500);
    const nove = await json<{ totalCentavos: number }>(await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 9 })]));
    expect(nove.totalCentavos).toBe(9 * 4200);
  });

  it('faixas por produto: com 3 faixas, cada quantidade paga a sua; com uma faixa só, preço único', async () => {
    const camisa = 'CAMISA ADULTO MALHA DRY FIT';
    const { rows } = await amb.pg.query<{ id: string; malha: string }>('select id, malha from produtos where nome = $1', [camisa]);
    const faixas = [{ aPartirDe: 1, centavos: 4200 }, { aPartirDe: 15, centavos: 3800 }, { aPartirDe: 20, centavos: 3500 }];
    const r = await amb.chamar(ID.admin, `/precos/${rows[0]!.id}`, { nome: camisa, malha: rows[0]!.malha, faixas, ativo: true });
    expect(r.status).toBe(200);
    // As colunas antigas acompanham (primeira e última faixa), para a versão anterior da API durante a publicação.
    expect((await amb.pg.query('select preco_menor_centavos as menor, preco_maior_centavos as maior from produtos where id = $1', [rows[0]!.id])).rows[0]).toEqual({ menor: 4200, maior: 3500 });

    for (const [pecas, unitario] of [[14, 4200], [15, 3800], [19, 3800], [20, 3500], [30, 3500]] as const) {
      const { totalCentavos } = await json<{ totalCentavos: number }>(await abrir([item(camisa, { M: pecas })]));
      expect(totalCentavos, `${pecas} peças`).toBe(pecas * unitario);
    }

    await amb.chamar(ID.admin, `/precos/${rows[0]!.id}`, { nome: camisa, malha: rows[0]!.malha, faixas: [{ aPartirDe: 1, centavos: 3900 }], ativo: true });
    expect((await json<{ totalCentavos: number }>(await abrir([item(camisa, { M: 3 })]))).totalCentavos).toBe(3 * 3900);
    expect((await json<{ totalCentavos: number }>(await abrir([item(camisa, { M: 40 })]))).totalCentavos).toBe(40 * 3900);
  });

  it('a faixa vale por produto: 6 camisas + 6 calções, cada produto na faixa de menos de 10', async () => {
    const r = await json<{ totalCentavos: number }>(
      await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 6 }), item('CALÇÃO ADULTO MALHA DRY FIT', { M: 6 })]),
    );
    expect(r.totalCentavos).toBe(6 * 4200 + 6 * 4200);
  });

  it('adicionais somam por peça em todas as peças do produto', async () => {
    const r = await json<{ totalCentavos: number }>(
      await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 }, { patch: true, golaV: true })], { bordado: true }),
    );
    expect(r.totalCentavos).toBe(10 * (3500 + 700 + 200));
  });

  it('grava o preço no item (cópia do dia) e o total no pedido; mudar o catálogo depois não muda o pedido', async () => {
    const { id } = await json<{ id: string }>(await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })]));
    await amb.pg.query(`update produtos set faixas = '[{"aPartirDe":1,"centavos":9999}]' where nome = 'CAMISA ADULTO MALHA DRY FIT'`);
    const { rows } = await amb.pg.query(
      'select i.produto, i.malha, i.preco_unitario_centavos, i.adicionais_unitario_centavos, i.subtotal_centavos, l.total_centavos from itens_pedido i join lotes l on l.id = i.lote_id where l.id = $1',
      [id],
    );
    expect(rows).toEqual([{ produto: 'CAMISA ADULTO MALHA DRY FIT', malha: 'DRY FIT', preco_unitario_centavos: 3500, adicionais_unitario_centavos: 0, subtotal_centavos: 35_000, total_centavos: 35_000 }]);
  });

  it('ignora um total ou preço que a tela tente mandar', async () => {
    const r = await json<{ totalCentavos: number }>(
      await abrir([{ ...item('CAMISA ADULTO MALHA DRY FIT', { M: 10 }), precoUnitarioCentavos: 1, subtotalCentavos: 1 }], { totalCentavos: 1 }),
    );
    expect(r.totalCentavos).toBe(35_000);
  });

  it('aceita o nome sem diferenciar maiúsculas e grava o nome do catálogo', async () => {
    const { id } = await json<{ id: string }>(await abrir([item('Camisa adulto malha dry fit', { M: 10 })]));
    expect((await amb.pg.query('select produto from itens_pedido where lote_id = $1', [id])).rows).toEqual([{ produto: 'CAMISA ADULTO MALHA DRY FIT' }]);
  });

  it('recusa produto fora do catálogo ou desativado, sem criar nada', async () => {
    const fora = await abrir([item('CAMISA INVENTADA', { M: 10 })]);
    expect(fora.status).toBe(400);
    expect((await json<{ erro: string }>(fora)).erro).toMatch(/não está no catálogo/);
    await amb.pg.query(`update produtos set ativo = false where nome = 'CAMISA ADULTO MALHA DRY FIT'`);
    expect((await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })])).status).toBe(400);
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(0);
  });

  it('recusa a grade que não combina com o produto (infantil x adulto)', async () => {
    const r = await abrir([{ produto: 'CAMISA INFANTIL MALHA DRY FIT PLUS', modo: 'adulto', grade: { M: 10 } }]);
    expect(r.status).toBe(400);
    expect((await json<{ erro: string }>(r)).erro).toMatch(/grade infantil/);
  });

  it('pedido de Feira não é cobrado: total zero, e não aceita entrada', async () => {
    const r = await amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Feira',
      descricao: 'Feira do Centro',
      dataEntrega: somarDias(diaEmFortaleza(), 10),
      itens: [item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })],
    });
    expect(r.status).toBe(201);
    expect((await json<{ totalCentavos: number }>(r)).totalCentavos).toBe(0);
    const comEntrada = await amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Feira',
      descricao: 'Feira do Centro',
      dataEntrega: somarDias(diaEmFortaleza(), 10),
      itens: [item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })],
      entrada: { valorCentavos: 100, forma: 'Pix' },
    });
    expect(comEntrada.status).toBe(400);
  });
});

describe('GET /lotes/:id/orcamento (RF-15 a RF-17)', () => {
  async function pedidoComEntrada() {
    const r = await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 6, G: 4 }, { golaV: true }), item('CALÇÃO ADULTO MALHA HELANCA', { M: 3 })], {
      entrada: { valorCentavos: 10_000, forma: 'Pix' },
    });
    return json<{ id: string; totalCentavos: number }>(r);
  }

  it('traz cliente, itens com preço do dia, total, recebimentos e saldo', async () => {
    const { id, totalCentavos } = await pedidoComEntrada();
    const o = await json<OrcamentoDoPedido>(amb.chamar(ID.atendimento, `/lotes/${id}/orcamento`));
    expect(o.cliente).toMatchObject({ nome: 'Clube Exemplo', documento: '12.345.678/0001-90', cidade: 'Fortaleza/CE' });
    expect(o.itens).toHaveLength(2);
    expect(o.itens[0]).toMatchObject({ produto: 'CAMISA ADULTO MALHA DRY FIT', quantidade: 10, adicionais: ['Gola V'], unitarioCentavos: 3500 + 200, subtotalCentavos: 10 * 3700 });
    expect(o.pecas).toBe(13);
    expect(o.totalCentavos).toBe(totalCentavos);
    expect(o.totalCentavos).toBe(o.itens.reduce((s, i) => s + i.subtotalCentavos, 0));
    expect(o.recebimentos).toMatchObject([{ valorCentavos: 10_000, forma: 'Pix' }]);
    expect(o).toMatchObject({ recebidoCentavos: 10_000, saldoCentavos: totalCentavos - 10_000 });
    expect(o.criadoEm).toBe(diaEmFortaleza());
  });

  it('atendimento, direção e admin abrem; setor e sem login não', async () => {
    const { id } = await pedidoComEntrada();
    for (const quem of [ID.admin, ID.direcao]) expect((await amb.chamar(quem, `/lotes/${id}/orcamento`)).status).toBe(200);
    for (const quem of [ID.costura]) expect((await amb.chamar(quem, `/lotes/${id}/orcamento`)).status).toBe(403);
    expect((await amb.chamar(null, `/lotes/${id}/orcamento`)).status).toBe(401);
  });

  it('pedido de Feira não tem orçamento (400); inexistente: 404; identificador malformado: 400', async () => {
    const feira = await json<{ id: string }>(
      await amb.chamar(ID.atendimento, '/pedidos', { tipo: 'Feira', descricao: 'Feira do Centro', dataEntrega: somarDias(diaEmFortaleza(), 10), itens: [item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })] }),
    );
    expect((await amb.chamar(ID.atendimento, `/lotes/${feira.id}/orcamento`)).status).toBe(400);
    expect((await amb.chamar(ID.atendimento, '/lotes/11111111-1111-4111-8111-111111111111/orcamento')).status).toBe(404);
    expect((await amb.chamar(ID.atendimento, '/lotes/nao-e-id/orcamento')).status).toBe(400);
  });
});

describe('malha na ficha, sem preços para o setor (RF-20 e RF-02)', () => {
  it('a ficha traz a malha de cada produto e a malha do calção, e o setor não recebe nenhum preço', async () => {
    const { id } = await json<{ id: string }>(
      await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 }), item('CALÇÃO ADULTO MALHA HELANCA', { M: 10 })]),
    );
    await amb.pg.query(`update lotes set etapa = 'Costura' where id = $1`, [id]);

    const doSetor = await json<FichaLote>(amb.chamar(ID.costura, `/lotes/${id}`));
    expect(doSetor.itens.map((i) => i.malha)).toEqual(['DRY FIT', 'HELANCA']);
    expect(doSetor.malhaCalcao).toBe('Helanca');
    expect(doSetor.valores).toBeUndefined();
    expect(JSON.stringify(doSetor)).not.toMatch(/centavos|preco|subtotal|12\.345|98888/i);

    const doAtendimento = await json<FichaLote>(amb.chamar(ID.atendimento, `/lotes/${id}`));
    expect(doAtendimento.valores?.totalCentavos).toBe(10 * 3500 + 10 * (await precoDe('CALÇÃO ADULTO MALHA HELANCA', 10)));
  });

  it('pedido sem calção: "Não se aplica"', async () => {
    const { id } = await json<{ id: string }>(await abrir([item('CAMISA ADULTO MALHA DRY FIT', { M: 10 })]));
    expect((await json<FichaLote>(amb.chamar(ID.atendimento, `/lotes/${id}`))).malhaCalcao).toBe('Não se aplica');
  });

  async function precoDe(nome: string, quantidade: number): Promise<number> {
    const { rows } = await amb.pg.query<{ faixas: FaixaDePreco[] }>('select faixas from produtos where nome = $1', [nome]);
    return precoDaFaixa(rows[0]!.faixas, quantidade);
  }
});
