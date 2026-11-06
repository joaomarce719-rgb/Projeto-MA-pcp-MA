import { diaEmFortaleza, somarDias, type ProdutoDePreco, type ProdutoDoCatalogo, type UsuarioLinha } from '@pcp/shared';
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

/** Uma segunda pessoa do Atendimento, esta com a permissão de gerenciar preços dada pelo Administrador. */
const ATENDENTE_DE_PRECOS = '00000000-0000-0000-0000-0000000000c1';
async function criarAtendenteDePrecos() {
  await amb.pg.query('insert into auth.users (id) values ($1)', [ATENDENTE_DE_PRECOS]);
  await amb.pg.query(
    `insert into perfis (id, nome, email, papel, gerencia_precos) values ($1, 'Rita Preços', 'rita@teste.local', 'atendimento', true)`,
    [ATENDENTE_DE_PRECOS],
  );
}

const produtoNovo = { nome: 'Camisa polo piquet', malha: 'piquet', maiorCentavos: 4500, menorCentavos: 5200, ativo: true };

async function produtos(quem: string) {
  return (await json<{ produtos: ProdutoDePreco[] }>(amb.chamar(quem, '/precos'))).produtos;
}

async function idDo(nome: string) {
  return (await amb.pg.query<{ id: string }>('select id from produtos where nome = $1', [nome])).rows[0]!.id;
}

async function abrirPedido(produto: string, grade: Record<string, number>) {
  if (!clienteSalvo) {
    const c = await json<{ cliente: { id: string } }>(
      amb.chamar(ID.atendimento, '/clientes', { nome: 'Clube Exemplo', documento: '12.345.678/0001-90', telefone: '(85) 98888-7777', cidade: 'Fortaleza/CE' }),
    );
    clienteSalvo = c.cliente.id;
  }
  return json<{ id: string; totalCentavos: number }>(
    amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Cliente',
      clienteId: clienteSalvo,
      dataEntrega: somarDias(diaEmFortaleza(), 10),
      itens: [{ produto, modo: 'adulto', grade }],
    }),
  );
}

describe('quem gerencia preços (RN-11)', () => {
  it('o Administrador, a Direção e o atendente com permissão veem a lista completa, ativos e desativados', async () => {
    await criarAtendenteDePrecos();
    await amb.pg.query(`update produtos set ativo = false where nome = 'FAIXA DE CAPITÃO'`);
    for (const quem of [ID.admin, ID.direcao, ATENDENTE_DE_PRECOS]) {
      const lista = await produtos(quem);
      expect(lista).toHaveLength(46);
      expect(lista.find((p) => p.nome === 'FAIXA DE CAPITÃO')?.ativo).toBe(false);
      expect(lista.find((p) => p.nome === 'CAMISA ADULTO MALHA DRY FIT')).toMatchObject({ maiorCentavos: 3500, menorCentavos: 4200, ativo: true });
    }
  });

  it('atendimento sem a permissão, setor e quem não entrou não passam (em leitura e em escrita)', async () => {
    const id = await idDo('CAMISA ADULTO MALHA DRY FIT');
    for (const quem of [ID.atendimento, ID.costura, ID.impressao]) {
      expect((await amb.chamar(quem, '/precos')).status).toBe(403);
      expect((await amb.chamar(quem, '/precos', produtoNovo)).status).toBe(403);
      expect((await amb.chamar(quem, `/precos/${id}`, produtoNovo)).status).toBe(403);
    }
    expect((await amb.chamar(null, '/precos')).status).toBe(401);
    expect((await amb.chamar(null, '/precos', produtoNovo)).status).toBe(401);
    expect((await amb.pg.query('select 1 from produtos')).rows).toHaveLength(46);
  });

  it('a permissão vem do banco a cada chamada: tirar a marca bloqueia na hora', async () => {
    await criarAtendenteDePrecos();
    expect((await amb.chamar(ATENDENTE_DE_PRECOS, '/precos')).status).toBe(200);
    await amb.pg.query('update perfis set gerencia_precos = false where id = $1', [ATENDENTE_DE_PRECOS]);
    expect((await amb.chamar(ATENDENTE_DE_PRECOS, '/precos')).status).toBe(403);
  });

  it('/me diz se a pessoa gerencia preços, para a tela mostrar a aba', async () => {
    await criarAtendenteDePrecos();
    expect(await json(amb.chamar(ATENDENTE_DE_PRECOS, '/me'))).toMatchObject({ papel: 'atendimento', gerenciaPrecos: true });
    expect(await json(amb.chamar(ID.atendimento, '/me'))).toMatchObject({ gerenciaPrecos: false });
  });
});

describe('POST /precos: novo produto', () => {
  it('cria o produto com nome e malha em maiúsculas e registra quem criou', async () => {
    await criarAtendenteDePrecos();
    const r = await amb.chamar(ATENDENTE_DE_PRECOS, '/precos', produtoNovo);
    expect(r.status).toBe(201);
    const criado = (await produtos(ID.admin)).find((p) => p.nome === 'CAMISA POLO PIQUET');
    expect(criado).toMatchObject({ malha: 'PIQUET', maiorCentavos: 4500, menorCentavos: 5200, ativo: true, atualizadoPor: 'Rita Preços' });
  });

  it('o produto novo aparece no catálogo do pedido e já pode ser vendido com o preço novo', async () => {
    await amb.chamar(ID.admin, '/precos', produtoNovo);
    const { produtos: catalogo } = await json<{ produtos: ProdutoDoCatalogo[] }>(amb.chamar(ID.atendimento, '/catalogo'));
    expect(catalogo).toHaveLength(47);
    const pedido = await abrirPedido('CAMISA POLO PIQUET', { M: 10 });
    expect(pedido.totalCentavos).toBe(10 * 4500);
  });

  it('recusa nome repetido, mesmo escrito de outro jeito', async () => {
    const r = await amb.chamar(ID.admin, '/precos', { ...produtoNovo, nome: ' camisa  adulto malha dry fit ' });
    expect(r.status).toBe(409);
    expect((await json<{ erro: string }>(r)).erro).toMatch(/Já existe um produto chamado CAMISA ADULTO MALHA DRY FIT/);
  });

  it('recusa dados inválidos com a frase certa e não grava nada', async () => {
    const invertido = await amb.chamar(ID.admin, '/precos', { ...produtoNovo, maiorCentavos: 6000 });
    expect(invertido.status).toBe(400);
    expect((await json<{ erro: string }>(invertido)).erro).toMatch(/não pode ser maior/);
    expect((await amb.chamar(ID.admin, '/precos', { ...produtoNovo, menorCentavos: 0 })).status).toBe(400);
    expect((await amb.chamar(ID.admin, '/precos', { ...produtoNovo, nome: '' })).status).toBe(400);
    expect((await amb.chamar(ID.admin, '/precos', { ...produtoNovo, menorCentavos: '52,00' })).status).toBe(400);
    expect(await produtos(ID.admin)).toHaveLength(46);
  });
});

describe('POST /precos/:id: alterar preço, nome e situação', () => {
  it('a Direção cria produto sem precisar da marca', async () => {
    expect((await amb.chamar(ID.direcao, '/precos', produtoNovo)).status).toBe(201);
    expect((await amb.pg.query(`select 1 from produtos where nome = 'CAMISA POLO PIQUET'`)).rows).toHaveLength(1);
  });

  it('a Direção muda os preços sem precisar da marca', async () => {
    const id = await idDo('CAMISA ADULTO MALHA DRY FIT');
    const antes = (await produtos(ID.admin)).find((p) => p.id === id)!;
    const r = await amb.chamar(ID.direcao, `/precos/${id}`, { nome: antes.nome, malha: antes.malha, maiorCentavos: 3900, menorCentavos: 4600, ativo: true });
    expect(r.status).toBe(200);
    expect((await produtos(ID.admin)).find((p) => p.id === id)).toMatchObject({ maiorCentavos: 3900, menorCentavos: 4600 });
  });

  it('muda os preços e registra quem e quando', async () => {
    await criarAtendenteDePrecos();
    const id = await idDo('CAMISA ADULTO MALHA DRY FIT');
    const antes = (await produtos(ID.admin)).find((p) => p.id === id)!;
    const r = await amb.chamar(ATENDENTE_DE_PRECOS, `/precos/${id}`, { nome: antes.nome, malha: antes.malha, maiorCentavos: 3800, menorCentavos: 4500, ativo: true });
    expect(r.status).toBe(200);
    const depois = (await produtos(ID.admin)).find((p) => p.id === id)!;
    expect(depois).toMatchObject({ maiorCentavos: 3800, menorCentavos: 4500, atualizadoPor: 'Rita Preços' });
    expect(new Date(depois.atualizadoEm).getTime()).toBeGreaterThanOrEqual(new Date(antes.atualizadoEm).getTime());
  });

  it('o preço novo vale para o pedido novo; o pedido já aberto mantém o preço do dia', async () => {
    const antigo = await abrirPedido('CAMISA ADULTO MALHA DRY FIT', { M: 10 });
    expect(antigo.totalCentavos).toBe(10 * 3500);

    const id = await idDo('CAMISA ADULTO MALHA DRY FIT');
    await amb.chamar(ID.admin, `/precos/${id}`, { nome: 'Camisa adulto malha dry fit', malha: 'dry fit', maiorCentavos: 4000, menorCentavos: 4800, ativo: true });

    const novo = await abrirPedido('CAMISA ADULTO MALHA DRY FIT', { M: 10 });
    expect(novo.totalCentavos).toBe(10 * 4000);
    const lote = await amb.pg.query<{ total_centavos: number }>('select total_centavos from lotes where id = $1', [antigo.id]);
    expect(lote.rows[0]!.total_centavos).toBe(10 * 3500);
    const item = await amb.pg.query<{ preco_unitario_centavos: number }>('select preco_unitario_centavos from itens_pedido where lote_id = $1', [antigo.id]);
    expect(item.rows[0]!.preco_unitario_centavos).toBe(3500);
  });

  it('desativar tira do catálogo do pedido novo e reativar traz de volta', async () => {
    const id = await idDo('FAIXA DE CAPITÃO');
    const base = { nome: 'Faixa de capitão', malha: 'elástico', maiorCentavos: 1000, menorCentavos: 1200 };
    await amb.chamar(ID.admin, `/precos/${id}`, { ...base, ativo: false });
    const sem = await json<{ produtos: ProdutoDoCatalogo[] }>(amb.chamar(ID.atendimento, '/catalogo'));
    expect(sem.produtos.some((p) => p.nome === 'FAIXA DE CAPITÃO')).toBe(false);
    expect((await produtos(ID.admin)).find((p) => p.id === id)?.ativo).toBe(false);

    await amb.chamar(ID.admin, `/precos/${id}`, { ...base, ativo: true });
    const com = await json<{ produtos: ProdutoDoCatalogo[] }>(amb.chamar(ID.atendimento, '/catalogo'));
    expect(com.produtos.some((p) => p.nome === 'FAIXA DE CAPITÃO')).toBe(true);
  });

  it('renomear para um nome que já existe dá conflito; manter o próprio nome não', async () => {
    const id = await idDo('FAIXA DE CAPITÃO');
    const corpo = { malha: 'elástico', maiorCentavos: 1000, menorCentavos: 1200, ativo: true };
    expect((await amb.chamar(ID.admin, `/precos/${id}`, { ...corpo, nome: 'Camisa adulto malha dry fit' })).status).toBe(409);
    expect((await amb.chamar(ID.admin, `/precos/${id}`, { ...corpo, nome: 'Faixa de capitão' })).status).toBe(200);
  });

  it('produto que não existe dá 404; identificador torto dá 400; dados inválidos não gravam', async () => {
    expect((await amb.chamar(ID.admin, '/precos/00000000-0000-4000-8000-000000000000', produtoNovo)).status).toBe(404);
    expect((await amb.chamar(ID.admin, '/precos/abc', produtoNovo)).status).toBe(400);
    const id = await idDo('CAMISA ADULTO MALHA DRY FIT');
    expect((await amb.chamar(ID.admin, `/precos/${id}`, { ...produtoNovo, maiorCentavos: 9000 })).status).toBe(400);
    expect((await produtos(ID.admin)).find((p) => p.id === id)?.maiorCentavos).toBe(3500);
  });
});

describe('POST /usuarios/:id/precos: quem recebe a permissão', () => {
  it('o Administrador dá e tira a permissão de uma pessoa do Atendimento', async () => {
    expect((await amb.chamar(ID.atendimento, '/precos')).status).toBe(403);
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.atendimento}/precos`, { gerenciaPrecos: true })).status).toBe(200);
    expect((await amb.chamar(ID.atendimento, '/precos')).status).toBe(200);
    const { usuarios } = await json<{ usuarios: UsuarioLinha[] }>(amb.chamar(ID.admin, '/usuarios'));
    expect(usuarios.find((u) => u.id === ID.atendimento)?.gerenciaPrecos).toBe(true);
    expect(usuarios.find((u) => u.id === ID.costura)?.gerenciaPrecos).toBe(false);

    expect((await amb.chamar(ID.admin, `/usuarios/${ID.atendimento}/precos`, { gerenciaPrecos: false })).status).toBe(200);
    expect((await amb.chamar(ID.atendimento, '/precos')).status).toBe(403);
  });

  it('ninguém além do Administrador dá a permissão, nem a si mesmo', async () => {
    await criarAtendenteDePrecos();
    for (const quem of [ID.atendimento, ATENDENTE_DE_PRECOS, ID.direcao, ID.costura]) {
      expect((await amb.chamar(quem, `/usuarios/${ID.atendimento}/precos`, { gerenciaPrecos: true })).status).toBe(403);
    }
    expect((await amb.chamar(null, `/usuarios/${ID.atendimento}/precos`, { gerenciaPrecos: true })).status).toBe(401);
    expect((await amb.pg.query('select 1 from perfis where id = $1 and gerencia_precos', [ID.atendimento])).rows).toHaveLength(0);
  });

  it('setor e Direção não recebem a marca; usuário que não existe dá 404; corpo torto dá 400', async () => {
    for (const alvo of [ID.costura, ID.direcao]) {
      const r = await amb.chamar(ID.admin, `/usuarios/${alvo}/precos`, { gerenciaPrecos: true });
      expect(r.status).toBe(400);
      expect((await json<{ erro: string }>(r)).erro).toMatch(/Atendimento/);
    }
    expect((await amb.chamar(ID.admin, '/usuarios/00000000-0000-4000-8000-000000000000/precos', { gerenciaPrecos: true })).status).toBe(404);
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.atendimento}/precos`, { gerenciaPrecos: 'sim' })).status).toBe(400);
  });

  it('o banco também recusa a marca fora do Atendimento', async () => {
    await expect(amb.pg.query('update perfis set gerencia_precos = true where id = $1', [ID.costura])).rejects.toThrow();
  });
});
