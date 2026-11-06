import { diaEmFortaleza, somarDias } from '@pcp/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

const entrega = () => somarDias(diaEmFortaleza(), 10);

async function json<T = Record<string, unknown>>(r: Response | Promise<Response>): Promise<T> {
  return (await r).json() as Promise<T>;
}

async function novoCliente(campos: object = {}): Promise<{ id: string; nome: string }> {
  const r = await amb.chamar(ID.atendimento, '/clientes', {
    nome: 'Clube Atlético Exemplo',
    documento: '00.000.000/0001-00',
    telefone: '(85) 90000-0001',
    cidade: 'Fortaleza/CE',
    ...campos,
  });
  expect(r.status).toBe(201);
  return (await json<{ cliente: { id: string; nome: string } }>(r)).cliente;
}

const corpoDoPedido = (clienteId: string, extra: object = {}) => ({
  tipo: 'Cliente',
  clienteId,
  prioridade: 'Alta',
  dataEntrega: entrega(),
  bordado: false,
  punho: 'Sem punho',
  detalhes: 'Escudo no peito esquerdo.',
  itens: [
    { produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { P: 2, M: 6, G: 2, GG: 0 } },
    { produto: 'Calção adulto malha dry fit', modo: 'adulto', grade: { M: 4 } },
  ],
  ...extra,
});

async function abrirPedido(extra: object = {}, cliente?: { id: string }): Promise<{ id: string; numero: number }> {
  const c = cliente ?? (await novoCliente());
  const r = await amb.chamar(ID.atendimento, '/pedidos', corpoDoPedido(c.id, extra));
  expect(r.status).toBe(201);
  return json(r);
}

/** O admin pode concluir qualquer etapa; serve para levar o pedido até onde o teste precisa. */
async function levarAte(id: string, etapa: string) {
  const seguinte: Record<string, string> = { Design: 'Impressão', 'Impressão': 'Batida', Batida: 'Laser', Laser: 'Conferência' };
  for (let atual = 'Design'; atual !== etapa; atual = seguinte[atual]!) {
    const { versao } = (await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [id])).rows[0]!;
    const r = await amb.chamar(ID.admin, `/lotes/${id}/concluir`, { versao, maquina: '02' });
    expect(r.status).toBe(200);
  }
}

describe('clientes', () => {
  it('o atendimento cadastra e depois encontra por nome, documento ou cidade', async () => {
    await novoCliente();
    await novoCliente({ nome: 'Escola Modelo Aurora', documento: '00.000.000/0002-00', cidade: 'Caucaia/CE' });
    const busca = async (q: string) =>
      (await json<{ clientes: { nome: string }[] }>(amb.chamar(ID.atendimento, `/clientes?q=${encodeURIComponent(q)}`))).clientes.map((c) => c.nome);
    expect(await busca('aurora')).toEqual(['Escola Modelo Aurora']);
    expect(await busca('0001-00')).toEqual(['Clube Atlético Exemplo']);
    expect(await busca('caucaia')).toEqual(['Escola Modelo Aurora']);
    expect(await busca('')).toHaveLength(2);
    expect(await busca('não existe')).toEqual([]);
  });

  it('% e _ na busca são texto, não curinga', async () => {
    await novoCliente();
    const { clientes } = await json<{ clientes: unknown[] }>(amb.chamar(ID.atendimento, '/clientes?q=%25'));
    expect(clientes).toEqual([]);
  });

  it('documento repetido: 409 com o nome de quem já tem', async () => {
    await novoCliente();
    const r = await amb.chamar(ID.atendimento, '/clientes', { nome: 'Outro Clube', documento: '00.000.000/0001-00' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/Clube Atlético Exemplo/);
  });

  it('dois cadastros do mesmo documento ao mesmo tempo: um passa, o outro recebe 409 (não 500)', async () => {
    const corpo = { nome: 'Clube Simultâneo', documento: '11.111.111/0001-11' };
    const respostas = await Promise.all([amb.chamar(ID.atendimento, '/clientes', corpo), amb.chamar(ID.atendimento, '/clientes', corpo)]);
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await amb.pg.query(`select 1 from clientes where documento = '11.111.111/0001-11'`)).rows).toHaveLength(1);
  });

  it('vários clientes sem documento são permitidos', async () => {
    expect((await amb.chamar(ID.atendimento, '/clientes', { nome: 'Cliente Um' })).status).toBe(201);
    expect((await amb.chamar(ID.atendimento, '/clientes', { nome: 'Cliente Dois' })).status).toBe(201);
  });

  it('nome com menos de 3 letras: 400', async () => {
    expect((await amb.chamar(ID.atendimento, '/clientes', { nome: 'Al' })).status).toBe(400);
  });

  it('o setor não lê nem cadastra clientes (LGPD): 403', async () => {
    await novoCliente();
    expect((await amb.chamar(ID.impressao, '/clientes')).status).toBe(403);
    expect((await amb.chamar(ID.impressao, '/clientes', { nome: 'Fulano de Tal' })).status).toBe(403);
  });

  it('a direção lê, mas não cadastra', async () => {
    await novoCliente();
    expect((await amb.chamar(ID.direcao, '/clientes')).status).toBe(200);
    expect((await amb.chamar(ID.direcao, '/clientes', { nome: 'Fulano de Tal' })).status).toBe(403);
  });
});

describe('abrir pedido', () => {
  it('Cliente: cria no Design, soma as grades, copia o nome do cliente e grava o histórico', async () => {
    const cliente = await novoCliente();
    const { id, numero } = await abrirPedido({}, cliente);
    expect(numero).toBeGreaterThan(0);

    const l = (await amb.pg.query<{ etapa: string; quantidade: number; descricao: string; cliente_id: string; versao: number; prioridade: string; punho: string }>(
      'select etapa, quantidade, descricao, cliente_id, versao, prioridade, punho from lotes where id = $1', [id])).rows[0]!;
    expect(l).toMatchObject({ etapa: 'Design', quantidade: 14, descricao: cliente.nome, cliente_id: cliente.id, versao: 1, prioridade: 'Alta', punho: 'Sem punho' });

    const itens = (await amb.pg.query<{ produto: string; quantidade: number; grade: Record<string, number> }>(
      'select produto, quantidade, grade from itens_pedido where lote_id = $1 order by ordem', [id])).rows;
    expect(itens.map((i) => i.quantidade)).toEqual([10, 4]);
    expect(itens[0]!.grade).toEqual({ P: 2, M: 6, G: 2 }); // o tamanho zerado não é gravado

    const h = (await amb.pg.query<{ etapa: string; tipo: string; usuario_id: string }>('select etapa, tipo, usuario_id from historico where lote_id = $1', [id])).rows;
    expect(h).toEqual([{ etapa: 'Atendimento', tipo: 'Cadastro', usuario_id: ID.atendimento }]);
  });

  it('Feira: usa a descrição e não tem cliente', async () => {
    const r = await amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Feira',
      descricao: 'Feira do Centro · camisas dry fit',
      dataEntrega: entrega(),
      itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 12 } }],
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const l = (await amb.pg.query<{ descricao: string; cliente_id: string | null; tipo: string; prioridade: string }>('select descricao, cliente_id, tipo, prioridade from lotes where id = $1', [id])).rows[0]!;
    expect(l).toEqual({ descricao: 'Feira do Centro · camisas dry fit', cliente_id: null, tipo: 'Feira', prioridade: 'Normal' });
  });

  it('os números são sequenciais, dados pelo sistema', async () => {
    const cliente = await novoCliente();
    const a = await abrirPedido({}, cliente);
    const b = await abrirPedido({}, cliente);
    expect(b.numero).toBe(a.numero + 1);
  });

  it('o pedido novo aparece na fila do Design, e não na da Impressão', async () => {
    await abrirPedido();
    const doDesign = await json<{ lotes: { etapa: string; quantidade: number }[] }>(amb.chamar(ID.design, '/fila'));
    expect(doDesign.lotes).toHaveLength(1);
    expect(doDesign.lotes[0]).toMatchObject({ etapa: 'Design', quantidade: 14 });
    expect((await json<{ lotes: unknown[] }>(amb.chamar(ID.impressao, '/fila'))).lotes).toHaveLength(0);
  });

  it('só o atendimento (e o admin) abre pedido: 403 para setor e direção, 401 sem login', async () => {
    const cliente = await novoCliente();
    const corpo = corpoDoPedido(cliente.id);
    expect((await amb.chamar(ID.impressao, '/pedidos', corpo)).status).toBe(403);
    expect((await amb.chamar(ID.direcao, '/pedidos', corpo)).status).toBe(403);
    expect((await amb.chamar(null, '/pedidos', corpo)).status).toBe(401);
    expect((await amb.chamar(ID.admin, '/pedidos', corpo)).status).toBe(201);
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(1);
  });

  it('cliente que não existe: 400 e nada é criado', async () => {
    const r = await amb.chamar(ID.atendimento, '/pedidos', corpoDoPedido('11111111-1111-4111-8111-111111111111'));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/Cliente não encontrado/);
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(0);
  });

  it.each([
    ['data de entrega no passado (RN-05)', { dataEntrega: somarDias(diaEmFortaleza(), -1) }, /passado/],
    ['data que não existe', { dataEntrega: '2026-02-31' }, /data de entrega/],
    ['patch sem bordado (RN-13)', { itens: [{ produto: 'Camisa adulto malha 3d', modo: 'adulto', grade: { M: 10 }, adicionais: { patch: true } }] }, /patch/],
    ['adicional punho sem tipo de punho (RN-14)', { itens: [{ produto: 'Camisa adulto malha 3d', modo: 'adulto', grade: { M: 10 }, adicionais: { punho: true } }] }, /punho/],
    ['sem produtos (RN-04)', { itens: [] }, /produto/i],
    ['grade zerada (RN-04)', { itens: [{ produto: 'Camisa infantil', modo: 'infantil', grade: { '8': 0 } }] }, /grade/],
  ])('recusa %s com a mensagem para a pessoa e sem criar nada', async (_nome, extra, mensagem) => {
    const cliente = await novoCliente();
    const r = await amb.chamar(ID.atendimento, '/pedidos', corpoDoPedido(cliente.id, extra));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { erro: string }).erro).toMatch(mensagem);
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(0);
  });

  it('é tudo ou nada: se um passo falha, nem o pedido nem os produtos ficam', async () => {
    const cliente = await novoCliente();
    await amb.pg.exec('drop table historico cascade'); // faz o último passo da transação falhar
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await amb.chamar(ID.atendimento, '/pedidos', corpoDoPedido(cliente.id));
    erro.mockRestore();
    expect(r.status).toBe(500);
    expect(((await r.json()) as { erro: string }).erro).not.toMatch(/historico|relation/i); // nada do banco vaza
    expect((await amb.pg.query('select 1 from lotes')).rows).toHaveLength(0);
    expect((await amb.pg.query('select 1 from itens_pedido')).rows).toHaveLength(0);
  });
});

describe('ficha do pedido', () => {
  it('o setor vê produtos, especificações e linha do tempo, mas nunca documento nem telefone do cliente', async () => {
    const { id } = await abrirPedido({ detalhes: 'Escudo no peito esquerdo.' });
    await levarAte(id, 'Impressão');

    const r = await amb.chamar(ID.impressao, `/lotes/${id}`);
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain('00.000.000/0001-00');
    expect(texto).not.toContain('90000-0001');
    const f = JSON.parse(texto) as { etapa: string; detalhes: string; cliente?: unknown; descricao: string; itens: { quantidade: number }[]; historico: { etapa: string; por: string; em: string }[] };
    expect(f.cliente).toBeUndefined();
    expect(f).toMatchObject({ etapa: 'Impressão', detalhes: 'Escudo no peito esquerdo.', descricao: 'Clube Atlético Exemplo' });
    expect(f.itens.map((i) => i.quantidade)).toEqual([10, 4]);
    expect(f.historico.map((h) => `${h.etapa}:${h.por}`)).toEqual(['Atendimento:Atendimento', 'Design:Admin']);
    expect(new Date(f.historico[0]!.em).toString()).not.toBe('Invalid Date'); // data ISO, serve em qualquer navegador
  });

  it('o setor não abre pedido de outro setor: 403', async () => {
    const { id } = await abrirPedido();
    expect((await amb.chamar(ID.impressao, `/lotes/${id}`)).status).toBe(403);
    expect((await amb.chamar(ID.design, `/lotes/${id}`)).status).toBe(200);
  });

  it('atendimento e direção recebem também os dados do cliente', async () => {
    const { id } = await abrirPedido();
    for (const quem of [ID.atendimento, ID.direcao, ID.admin]) {
      const f = await json<{ cliente?: { nome: string; documento: string; telefone: string; cidade: string } }>(amb.chamar(quem, `/lotes/${id}`));
      expect(f.cliente).toMatchObject({ nome: 'Clube Atlético Exemplo', documento: '00.000.000/0001-00', telefone: '(85) 90000-0001', cidade: 'Fortaleza/CE' });
    }
  });

  it('pedido de Feira não tem cliente na ficha', async () => {
    const r = await amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Feira',
      descricao: 'Feira do Centro',
      dataEntrega: entrega(),
      itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 5 } }],
    });
    const { id } = (await r.json()) as { id: string };
    const f = await json<{ cliente?: unknown; descricao: string }>(amb.chamar(ID.direcao, `/lotes/${id}`));
    expect(f.cliente).toBeUndefined();
    expect(f.descricao).toBe('Feira do Centro');
  });

  it('pedido inexistente: 404; identificador malformado: 400; sem login: 401', async () => {
    expect((await amb.chamar(ID.admin, '/lotes/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await amb.chamar(ID.admin, '/lotes/xyz')).status).toBe(400);
    expect((await amb.chamar(null, '/lotes/00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });
});

describe('devolver ao Design (recuperação)', () => {
  const MOTIVO = '3 peças M com falha de sublimação na manga.';
  const versaoDe = async (id: string) =>
    (await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [id])).rows[0]!.versao;

  it('o Laser devolve: o pedido volta ao Design marcado como recuperação, com histórico e motivo', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    const versao = await versaoDe(id);

    const r = await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao, motivo: MOTIVO });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ etapa: 'Design', versao: versao + 1 });

    const l = (await amb.pg.query<{ etapa: string; recuperacao_pendente: boolean; recuperacoes: number }>(
      'select etapa, recuperacao_pendente, recuperacoes from lotes where id = $1', [id])).rows[0]!;
    expect(l).toEqual({ etapa: 'Design', recuperacao_pendente: true, recuperacoes: 1 });

    const h = (await amb.pg.query<{ etapa: string; tipo: string; nota: string; usuario_id: string }>(
      `select etapa, tipo, nota, usuario_id from historico where lote_id = $1 and tipo = 'Recuperação'`, [id])).rows;
    expect(h).toEqual([{ etapa: 'Laser', tipo: 'Recuperação', nota: MOTIVO, usuario_id: ID.laser }]);
  });

  it('a fila do Design mostra a recuperação com o motivo; ao concluir, volta para a Impressão e o motivo some', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao: await versaoDe(id), motivo: MOTIVO });

    type Fila = { lotes: { recuperacaoPendente: boolean; motivoRecuperacao: string | null; etapa: string; versao: number }[] };
    const antes = (await json<Fila>(amb.chamar(ID.design, '/fila'))).lotes[0]!;
    expect(antes).toMatchObject({ etapa: 'Design', recuperacaoPendente: true, motivoRecuperacao: MOTIVO });

    const r = await amb.chamar(ID.design, `/lotes/${id}/concluir`, { versao: antes.versao });
    expect(((await r.json()) as { etapa: string }).etapa).toBe('Impressão');

    const naImpressao = (await json<Fila>(amb.chamar(ID.impressao, '/fila'))).lotes[0]!;
    expect(naImpressao).toMatchObject({ recuperacaoPendente: false, motivoRecuperacao: null });
  });

  it('a Conferência também devolve', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Conferência');
    await amb.pg.query(`update perfis set setor = 'Conferência' where id = $1`, [ID.laser]);
    const r = await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao: await versaoDe(id), motivo: MOTIVO });
    expect(r.status).toBe(200);
  });

  it('só Laser e Conferência devolvem: a Impressão, com o pedido na sua fila, recebe 403', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Impressão');
    const r = await amb.chamar(ID.impressao, `/lotes/${id}/devolver`, { versao: await versaoDe(id), motivo: MOTIVO });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/Laser e a Conferência/);
    expect(await versaoDe(id)).toBe(2);
  });

  it('outro setor, direção e atendimento: 403; admin só nas etapas permitidas', async () => {
    const cliente = await novoCliente();
    const { id } = await abrirPedido({}, cliente);
    await levarAte(id, 'Laser');
    const versao = await versaoDe(id);
    const corpo = { versao, motivo: MOTIVO };
    for (const quem of [ID.costura, ID.direcao, ID.atendimento]) {
      expect((await amb.chamar(quem, `/lotes/${id}/devolver`, corpo)).status).toBe(403);
    }
    expect((await amb.chamar(ID.admin, `/lotes/${id}/devolver`, corpo)).status).toBe(200);

    const outro = await abrirPedido({}, cliente);
    await levarAte(outro.id, 'Batida');
    expect((await amb.chamar(ID.admin, `/lotes/${outro.id}/devolver`, { versao: await versaoDe(outro.id), motivo: MOTIVO })).status).toBe(403);
  });

  it('motivo curto ou ausente: 400 e o pedido não se move', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    const versao = await versaoDe(id);
    expect((await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao, motivo: 'ok' })).status).toBe(400);
    expect((await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao, motivo: '   ' })).status).toBe(400);
    expect((await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao })).status).toBe(400);
    expect(await versaoDe(id)).toBe(versao);
  });

  it('versão desatualizada: 409 e nada muda', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    const versao = await versaoDe(id);
    expect((await amb.chamar(ID.laser, `/lotes/${id}/devolver`, { versao: versao - 1, motivo: MOTIVO })).status).toBe(409);
    expect(await versaoDe(id)).toBe(versao);
  });

  it('dois cliques ao mesmo tempo: um devolve (200), o outro é recusado (409), com um só registro', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    const corpo = { versao: await versaoDe(id), motivo: MOTIVO };
    const respostas = await Promise.all([
      amb.chamar(ID.laser, `/lotes/${id}/devolver`, corpo),
      amb.chamar(ID.laser, `/lotes/${id}/devolver`, corpo),
    ]);
    expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await amb.pg.query(`select 1 from historico where tipo = 'Recuperação'`)).rows).toHaveLength(1);
    expect((await amb.pg.query<{ recuperacoes: number }>('select recuperacoes from lotes where id = $1', [id])).rows[0]!.recuperacoes).toBe(1);
  });

  it('depois de devolvido, o Laser que clica de novo recebe 409 (já passou), não 403', async () => {
    const { id } = await abrirPedido();
    await levarAte(id, 'Laser');
    const corpo = { versao: await versaoDe(id), motivo: MOTIVO };
    await amb.chamar(ID.laser, `/lotes/${id}/devolver`, corpo);
    expect((await amb.chamar(ID.laser, `/lotes/${id}/devolver`, corpo)).status).toBe(409);
  });
});
