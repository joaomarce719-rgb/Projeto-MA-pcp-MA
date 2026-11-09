import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

interface Acesso {
  perfil_id: string;
  cliente_id: string;
  tela: string;
  lote_id: string | null;
}

const acessos = async () =>
  (await amb.pg.query<Acesso>('select perfil_id, cliente_id, tela, lote_id from acessos_dados_pessoais order by id')).rows;

const CPF = '123.456.789-01';
const CNPJ = '12.345.678/0001-90';
const TELEFONE = '(85) 90000-0000';

async function cliente(nome: string, documento = CPF): Promise<string> {
  const r = await amb.pg.query<{ id: string }>(
    `insert into clientes (nome, documento, telefone, cidade) values ($1, $2, $3, 'Fortaleza') returning id`,
    [nome, documento, TELEFONE],
  );
  return r.rows[0]!.id;
}

/** Pedido de Cliente na etapa pedida, já ligado ao cliente. */
async function pedidoDe(clienteId: string, etapa = 'Costura'): Promise<string> {
  const id = await amb.lote({ descricao: 'Pedido', etapa });
  await amb.pg.query('update lotes set cliente_id = $1 where id = $2', [clienteId, id]);
  return id;
}

describe('busca de clientes: só o necessário para escolher (RNF-02, minimização)', () => {
  it('sai sem telefone, com CPF mascarado e CNPJ inteiro, e não entra no registro', async () => {
    await cliente('Ana Pessoa', CPF);
    await cliente('Clube Empresa', CNPJ);
    const r = await amb.chamar(ID.atendimento, '/clientes');
    const texto = await r.text();
    expect(texto).not.toContain(TELEFONE);
    expect(texto).not.toContain(CPF);
    const { clientes } = JSON.parse(texto) as { clientes: { nome: string; documento: string; telefone: null }[] };
    expect(clientes).toEqual([
      expect.objectContaining({ nome: 'Ana Pessoa', documento: '***.456.789-**', telefone: null }),
      expect.objectContaining({ nome: 'Clube Empresa', documento: CNPJ, telefone: null }),
    ]);
    expect(await acessos()).toEqual([]);
  });

  it('ainda encontra pelo CPF completo, mesmo devolvendo mascarado', async () => {
    await cliente('Ana Pessoa', CPF);
    const { clientes } = (await (await amb.chamar(ID.atendimento, `/clientes?q=${encodeURIComponent(CPF)}`)).json()) as {
      clientes: { nome: string }[];
    };
    expect(clientes.map((c) => c.nome)).toEqual(['Ana Pessoa']);
  });
});

describe('registro de acesso a dados pessoais (RNF-02, LGPD)', () => {
  it('a ficha grava o cliente e o pedido para quem recebe os dados', async () => {
    const c = await cliente('Clube Alfa');
    const lote = await pedidoDe(c);
    expect((await amb.chamar(ID.direcao, `/lotes/${lote}`)).status).toBe(200);
    expect(await acessos()).toEqual([{ perfil_id: ID.direcao, cliente_id: c, tela: 'ficha', lote_id: lote }]);
  });

  it('o setor abre a ficha sem dados pessoais, então nada é gravado', async () => {
    const c = await cliente('Clube Alfa');
    const lote = await pedidoDe(c, 'Costura');
    const r = await amb.chamar(ID.costura, `/lotes/${lote}`);
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(TELEFONE);
    expect(await acessos()).toEqual([]);
  });

  it('o orçamento grava o cliente e o pedido', async () => {
    const c = await cliente('Clube Alfa');
    const lote = await pedidoDe(c);
    expect((await amb.chamar(ID.atendimento, `/lotes/${lote}/orcamento`)).status).toBe(200);
    expect(await acessos()).toEqual([{ perfil_id: ID.atendimento, cliente_id: c, tela: 'orcamento', lote_id: lote }]);
  });

  it('quem recebe 403 não gera registro', async () => {
    const c = await cliente('Clube Alfa');
    const lote = await pedidoDe(c, 'Laser');
    expect((await amb.chamar(ID.costura, `/lotes/${lote}`)).status).toBe(403);
    expect(await acessos()).toEqual([]);
  });

  it('se o registro falhar, a ficha e o orçamento dão erro e o dado não sai (falha fechada)', async () => {
    const c = await cliente('Clube Alfa');
    const lote = await pedidoDe(c);
    await amb.pg.exec('alter table acessos_dados_pessoais rename to acessos_fora_do_ar');
    for (const caminho of [`/lotes/${lote}`, `/lotes/${lote}/orcamento`]) {
      const r = await amb.chamar(ID.atendimento, caminho);
      expect(r.status, caminho).toBe(500);
      const texto = await r.text();
      expect(texto, caminho).not.toContain(CPF);
      expect(texto, caminho).not.toContain(TELEFONE);
    }
  });

  it('o banco só aceita incluir: alterar, apagar ou esvaziar é recusado', async () => {
    const c = await cliente('Clube Alfa');
    await amb.chamar(ID.atendimento, `/lotes/${await pedidoDe(c)}`);
    await expect(amb.pg.query(`update acessos_dados_pessoais set tela = 'orcamento'`)).rejects.toThrow(/não pode ser alterado/);
    await expect(amb.pg.query('delete from acessos_dados_pessoais')).rejects.toThrow(/não pode ser alterado/);
    await expect(amb.pg.query('truncate acessos_dados_pessoais')).rejects.toThrow(/não pode ser alterado/);
    expect(await acessos()).toHaveLength(1);
  });
});
