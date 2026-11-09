import { CLIENTE_REMOVIDO, diaEmFortaleza, somarDias } from '@pcp/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

const NOME = 'Ana Maria Souza';
const CPF = '123.456.789-01';
const TELEFONE = '(85) 98888-7777';
const ANO = Number(diaEmFortaleza().slice(0, 4));

async function cliente(documento = CPF): Promise<string> {
  const r = await amb.pg.query<{ id: string }>(
    `insert into clientes (nome, documento, telefone, cidade) values ($1, $2, $3, 'Fortaleza') returning id`,
    [NOME, documento, TELEFONE],
  );
  return r.rows[0]!.id;
}

/** Pedido do cliente, concluído (ou não) no ano pedido, com observação e histórico que citam o cliente. */
async function pedido(clienteId: string, { ano = ANO - 7, etapa = 'Concluído' } = {}): Promise<string> {
  const id = await amb.lote({ descricao: NOME, etapa: etapa === 'Concluído' ? 'Embalagem' : etapa });
  await amb.pg.query(
    `update lotes set cliente_id = $1, etapa = $3, detalhes = $4,
            criado_em = $5::timestamptz, finalizado_em = case when $3 = 'Concluído' then $5::timestamptz end
      where id = $2`,
    [clienteId, id, etapa, `Entregar para ${NOME}, CPF 12345678901. Banana no lanche.`, `${ano}-06-10T12:00:00Z`],
  );
  await amb.pg.query(
    `insert into historico (lote_id, etapa, tipo, nota, usuario_id) values ($1, 'Costura', 'Conclusão', $2, $3)`,
    [id, `Ligar para ${NOME.toUpperCase()} no ${TELEFONE}.`, ID.costura],
  );
  return id;
}

const pedirExclusao = (quem: string, id: string) => amb.chamar(quem, `/clientes/${id}/exclusao`, { motivo: 'Pediu por e-mail em 09/11/2026.' });
const anonimizar = (quem: string, id: string, confirmacao = NOME) => amb.chamar(quem, `/clientes/${id}/anonimizar`, { confirmacao });
const erro = async (r: Response) => ((await r.json()) as { erro: string }).erro;

describe('pedido de exclusão (LGPD art. 18)', () => {
  it('só o Administrador registra, lista e anonimiza', async () => {
    const c = await cliente();
    for (const quem of [ID.atendimento, ID.direcao, ID.costura]) {
      expect((await pedirExclusao(quem, c)).status).toBe(403);
      expect((await amb.chamar(quem, '/lgpd/exclusoes')).status).toBe(403);
      expect((await anonimizar(quem, c)).status).toBe(403);
    }
  });

  it('registra uma vez e devolve a data em que os dados poderão ser anonimizados', async () => {
    const c = await cliente();
    await pedido(c, { ano: ANO });
    const r = await pedirExclusao(ID.admin, c);
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { liberadoEm: string; impedimento: string };
    expect(corpo.liberadoEm).toBe(`${ANO + 6}-01-01`);
    expect(corpo.impedimento).toMatch(new RegExp(`até 01/01/${ANO + 6}`));
    expect((await pedirExclusao(ID.admin, c)).status).toBe(409);
  });

  it('CNPJ é de empresa: não registra nem anonimiza', async () => {
    const c = await cliente('12.345.678/0001-90');
    const r = await pedirExclusao(ID.admin, c);
    expect(r.status).toBe(400);
    expect(await erro(r)).toMatch(/CNPJ/);
  });

  it('a lista mostra quem ainda espera o prazo e quem já pode, os que podem primeiro', async () => {
    const recente = await cliente();
    await pedido(recente, { ano: ANO });
    const antigo = (await amb.pg.query<{ id: string }>(`insert into clientes (nome) values ('Bruno Antigo') returning id`)).rows[0]!.id;
    await pedido(antigo, { ano: ANO - 7 });
    await pedirExclusao(ID.admin, recente);
    await pedirExclusao(ID.admin, antigo);
    const { clientes } = (await (await amb.chamar(ID.admin, '/lgpd/exclusoes')).json()) as {
      clientes: { id: string; pode: boolean; liberadoEm: string }[];
    };
    expect(clientes.map((c) => [c.id, c.pode])).toEqual([
      [antigo, true],
      [recente, false],
    ]);
  });
});

describe('anonimização', () => {
  it('dentro do prazo de guarda: recusa e diz até quando, sem mudar nada', async () => {
    const c = await cliente();
    await pedido(c, { ano: ANO - 2 });
    await pedirExclusao(ID.admin, c);
    const r = await anonimizar(ID.admin, c);
    expect(r.status).toBe(400);
    expect(await erro(r)).toMatch(new RegExp(`até 01/01/${ANO + 4}`));
    expect((await amb.pg.query(`select nome from clientes where id = $1`, [c])).rows).toEqual([{ nome: NOME }]);
  });

  it('com pedido em andamento: recusa, mesmo que o pedido antigo já tenha passado do prazo', async () => {
    const c = await cliente();
    await pedido(c, { ano: ANO - 7 });
    await pedido(c, { ano: ANO - 7, etapa: 'Costura' });
    await pedirExclusao(ID.admin, c);
    const r = await anonimizar(ID.admin, c);
    expect(r.status).toBe(400);
    expect(await erro(r)).toMatch(/em andamento/);
  });

  it('sem pedido de exclusão registrado ou com o nome errado na confirmação: recusa', async () => {
    const c = await cliente();
    await pedido(c);
    expect(await erro(await anonimizar(ID.admin, c))).toMatch(/Registre antes/);
    await pedirExclusao(ID.admin, c);
    const r = await anonimizar(ID.admin, c, 'Ana Souza');
    expect(r.status).toBe(400);
    expect(await erro(r)).toMatch(/não confere/);
  });

  it('depois do prazo: limpa o cadastro, os pedidos e as observações numa vez só, e guarda quem fez', async () => {
    const c = await cliente();
    const lote = await pedido(c);
    await amb.pg.query(`insert into recebimentos (lote_id, valor_centavos, forma, momento) values ($1, 5000, 'Pix', 'Entrada')`, [lote]);
    await pedirExclusao(ID.admin, c);

    const r = await anonimizar(ID.admin, c, '  ana maria souza ');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ observacoesTrocadas: 2 });

    const [cad] = (
      await amb.pg.query<Record<string, unknown>>(
        'select nome, documento, telefone, cidade, anonimizado_por, anonimizado_em is not null as feito from clientes where id = $1',
        [c],
      )
    ).rows;
    expect(cad).toEqual({ nome: CLIENTE_REMOVIDO, documento: null, telefone: null, cidade: null, anonimizado_por: ID.admin, feito: true });

    const [l] = (await amb.pg.query<{ descricao: string; detalhes: string }>('select descricao, detalhes from lotes where id = $1', [lote])).rows;
    expect(l).toEqual({ descricao: CLIENTE_REMOVIDO, detalhes: 'Entregar para [removido], CPF [removido]. Banana no lanche.' });
    const [h] = (await amb.pg.query<{ nota: string }>('select nota from historico where lote_id = $1', [lote])).rows;
    expect(h!.nota).toBe('Ligar para [removido] no [removido].');

    // O pagamento continua: o financeiro não muda.
    expect((await amb.pg.query('select valor_centavos from recebimentos where lote_id = $1', [lote])).rows).toEqual([{ valor_centavos: 5000 }]);
    // Some da busca e da lista; uma segunda vez é recusada.
    const busca = await (await amb.chamar(ID.atendimento, '/clientes')).text();
    expect(busca).not.toContain(c);
    const lista = (await (await amb.chamar(ID.admin, '/lgpd/exclusoes')).json()) as { clientes: unknown[] };
    expect(lista.clientes).toEqual([]);
    expect((await anonimizar(ID.admin, c, CLIENTE_REMOVIDO)).status).toBe(409);
  });

  it('cliente anonimizado não entra em pedido novo', async () => {
    const c = await cliente();
    await pedido(c);
    await pedirExclusao(ID.admin, c);
    expect((await anonimizar(ID.admin, c)).status).toBe(200);
    const r = await amb.chamar(ID.atendimento, '/pedidos', {
      tipo: 'Cliente',
      clienteId: c,
      prioridade: 'Normal',
      dataEntrega: somarDias(diaEmFortaleza(), 10),
      bordado: false,
      punho: 'Sem punho',
      itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 10 } }],
    });
    expect(r.status).toBe(400);
    expect(await erro(r)).toMatch(/Cliente não encontrado/);
  });
});
