import { FOTOS_POR_PEDIDO, FOTO_TAMANHO_MAXIMO, diaEmFortaleza, somarDias } from '@pcp/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

/** Bytes que começam como cada formato. O servidor confere a assinatura, não decodifica a imagem. */
const jpeg = (extra = 32) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(extra).fill(7)]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(3)]);
const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50, ...new Array(24).fill(5)]);

async function pedido(): Promise<string> {
  const c = await amb.chamar(ID.atendimento, '/clientes', { nome: 'Clube Atlético Exemplo', documento: '00.000.000/0001-00' });
  const { cliente } = (await c.json()) as { cliente: { id: string } };
  const r = await amb.chamar(ID.atendimento, '/pedidos', {
    tipo: 'Cliente',
    clienteId: cliente.id,
    dataEntrega: somarDias(diaEmFortaleza(), 10),
    itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 10 } }],
  });
  return ((await r.json()) as { id: string }).id;
}

async function enviada(id: string, bytes = jpeg(), nome = 'frente.jpg'): Promise<string> {
  const r = await amb.enviarFoto(ID.atendimento, id, bytes, { nome });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

describe('enviar foto (RF-11)', () => {
  it('guarda o arquivo, grava os dados e devolve o id', async () => {
    const id = await pedido();
    const foto = await enviada(id, png(), 'costas.png');

    const linha = (await amb.pg.query<{ nome: string; tipo: string; tamanho: number; chave: string; enviado_por: string }>(
      'select nome, tipo, tamanho, chave, enviado_por from fotos where id = $1', [foto])).rows[0]!;
    expect(linha).toMatchObject({ nome: 'costas.png', tipo: 'image/png', tamanho: png().byteLength, enviado_por: ID.atendimento });
    expect(amb.arquivos.get(linha.chave)?.tipo).toBe('image/png');
    expect(linha.chave).toContain(id);
  });

  it('o tipo vem dos bytes, não do cabeçalho: um JPEG declarado como PNG é gravado como JPEG', async () => {
    const id = await pedido();
    const r = await amb.enviarFoto(ID.atendimento, id, jpeg(), { tipo: 'image/png' });
    expect(r.status).toBe(201);
    const { tipo } = (await amb.pg.query<{ tipo: string }>('select tipo from fotos')).rows[0]!;
    expect(tipo).toBe('image/jpeg');
  });

  it('aceita WebP', async () => {
    expect((await amb.enviarFoto(ID.atendimento, await pedido(), webp(), { tipo: 'image/webp' })).status).toBe(201);
  });

  it.each([
    ['um arquivo que não é imagem, mesmo declarado como JPEG', new TextEncoder().encode('<html><script>alert(1)</script></html>')],
    ['um SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')],
    ['um GIF', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3])],
  ])('recusa %s: 415 e nada é guardado', async (_nome, bytes) => {
    const id = await pedido();
    const r = await amb.enviarFoto(ID.atendimento, id, bytes as Uint8Array, { tipo: 'image/jpeg' });
    expect(r.status).toBe(415);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/JPEG, PNG ou WebP/);
    expect((await amb.pg.query('select 1 from fotos')).rows).toHaveLength(0);
    expect(amb.arquivos.size).toBe(0);
  });

  it('arquivo vazio: 400', async () => {
    expect((await amb.enviarFoto(ID.atendimento, await pedido(), new Uint8Array(0))).status).toBe(400);
  });

  it('maior que 2 MB: 413 (já pelo tamanho declarado) e nada é guardado', async () => {
    const id = await pedido();
    const r = await amb.enviarFoto(ID.atendimento, id, jpeg(FOTO_TAMANHO_MAXIMO + 10));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/2 MB/);
    expect(amb.arquivos.size).toBe(0);
  });

  it('maior que 2 MB sem tamanho declarado (envio em pedaços): 413, sem ler tudo, e nada é guardado', async () => {
    const id = await pedido();
    const pedaco = jpeg(512 * 1024);
    let enviados = 0;
    const corpo = new ReadableStream<Uint8Array>({
      pull(c) {
        enviados++;
        if (enviados > 10) c.close(); // ~5 MB no total, se alguém lesse tudo
        else c.enqueue(pedaco);
      },
    });
    const r = await amb.fetch(
      new Request(`http://api/lotes/${id}/fotos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ID.atendimento}`, 'Content-Type': 'image/jpeg' },
        body: corpo,
        duplex: 'half',
      } as RequestInit),
    );
    expect(r.status).toBe(413);
    expect(enviados).toBeLessThan(10);
    expect(amb.arquivos.size).toBe(0);
  });

  it(`no máximo ${FOTOS_POR_PEDIDO} fotos por pedido: a seguinte recebe 409`, async () => {
    const id = await pedido();
    for (let i = 0; i < FOTOS_POR_PEDIDO; i++) await enviada(id);
    const r = await amb.enviarFoto(ID.atendimento, id, jpeg());
    expect(r.status).toBe(409);
    expect((await amb.pg.query('select 1 from fotos')).rows).toHaveLength(FOTOS_POR_PEDIDO);
    expect(amb.arquivos.size).toBe(FOTOS_POR_PEDIDO);
  });

  it('dois envios ao mesmo tempo na última vaga: só um passa', async () => {
    const id = await pedido();
    for (let i = 0; i < FOTOS_POR_PEDIDO - 1; i++) await enviada(id);
    const respostas = await Promise.all([amb.enviarFoto(ID.atendimento, id, jpeg()), amb.enviarFoto(ID.atendimento, id, jpeg())]);
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await amb.pg.query('select 1 from fotos')).rows).toHaveLength(FOTOS_POR_PEDIDO);
  });

  it('só atendimento e admin enviam: setor e direção recebem 403; sem login, 401', async () => {
    const id = await pedido();
    expect((await amb.enviarFoto(ID.design, id, jpeg())).status).toBe(403);
    expect((await amb.enviarFoto(ID.direcao, id, jpeg())).status).toBe(403);
    expect((await amb.enviarFoto(null, id, jpeg())).status).toBe(401);
    expect((await amb.enviarFoto(ID.admin, id, jpeg())).status).toBe(201);
    expect(amb.arquivos.size).toBe(1);
  });

  it('pedido inexistente: 404; identificador malformado: 400', async () => {
    expect((await amb.enviarFoto(ID.atendimento, '00000000-0000-0000-0000-000000000000', jpeg())).status).toBe(404);
    expect((await amb.enviarFoto(ID.atendimento, 'xyz', jpeg())).status).toBe(400);
  });

  it('o nome é limpo: sem quebras de linha e com no máximo 100 letras', async () => {
    const id = await pedido();
    await amb.enviarFoto(ID.atendimento, id, jpeg(), { nome: 'frente\nlinha2' + 'x'.repeat(200) });
    const { nome } = (await amb.pg.query<{ nome: string }>('select nome from fotos')).rows[0]!;
    expect(nome).not.toContain('\n');
    expect(nome.length).toBeLessThanOrEqual(100);
  });

  it('se o armazenamento falhar, nada fica gravado no banco', async () => {
    const id = await pedido();
    amb.simularFalhaNoArmazenamento(true);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await amb.enviarFoto(ID.atendimento, id, jpeg());
    erro.mockRestore();
    expect(r.status).toBe(500);
    expect(((await r.json()) as { erro: string }).erro).not.toMatch(/R2/);
    expect((await amb.pg.query('select 1 from fotos')).rows).toHaveLength(0);
  });
});

describe('abrir foto (RNF-03)', () => {
  it('devolve os bytes com o tipo certo e cabeçalhos de proteção', async () => {
    const id = await pedido();
    const foto = await enviada(id, png());
    const r = await amb.chamar(ID.atendimento, `/fotos/${foto}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toMatch(/private/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png());
  });

  it('o setor abre a foto só enquanto o pedido está no seu setor', async () => {
    const id = await pedido();
    const foto = await enviada(id);
    expect((await amb.chamar(ID.design, `/fotos/${foto}`)).status).toBe(200);
    expect((await amb.chamar(ID.impressao, `/fotos/${foto}`)).status).toBe(403);
    expect((await amb.chamar(ID.costura, `/fotos/${foto}`)).status).toBe(403);
  });

  it('atendimento, direção e admin abrem de qualquer pedido; sem login, 401', async () => {
    const foto = await enviada(await pedido());
    for (const quem of [ID.atendimento, ID.direcao, ID.admin]) {
      expect((await amb.chamar(quem, `/fotos/${foto}`)).status).toBe(200);
    }
    expect((await amb.chamar(null, `/fotos/${foto}`)).status).toBe(401);
  });

  it('o pedido anda e a permissão do setor acompanha', async () => {
    const id = await pedido();
    const foto = await enviada(id);
    const { versao } = (await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [id])).rows[0]!;
    await amb.chamar(ID.design, `/lotes/${id}/concluir`, { versao });
    expect((await amb.chamar(ID.design, `/fotos/${foto}`)).status).toBe(403);
    expect((await amb.chamar(ID.impressao, `/fotos/${foto}`)).status).toBe(200);
  });

  it('foto que não existe: 404; id malformado: 400; arquivo sumido do armazenamento: 404', async () => {
    expect((await amb.chamar(ID.admin, '/fotos/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await amb.chamar(ID.admin, '/fotos/xyz')).status).toBe(400);
    const foto = await enviada(await pedido());
    amb.arquivos.clear();
    expect((await amb.chamar(ID.admin, `/fotos/${foto}`)).status).toBe(404);
  });
});

describe('fotos na ficha', () => {
  it('a ficha lista as fotos (id e nome) para quem pode ver o pedido', async () => {
    const id = await pedido();
    const a = await enviada(id, jpeg(), 'frente.jpg');
    const b = await enviada(id, png(), 'costas.png');
    const ficha = (await (await amb.chamar(ID.design, `/lotes/${id}`)).json()) as { fotos: { id: string; nome: string }[] };
    expect(ficha.fotos).toEqual([{ id: a, nome: 'frente.jpg' }, { id: b, nome: 'costas.png' }]);
  });

  it('pedido sem fotos devolve lista vazia', async () => {
    const ficha = (await (await amb.chamar(ID.atendimento, `/lotes/${await pedido()}`)).json()) as { fotos: unknown[] };
    expect(ficha.fotos).toEqual([]);
  });
});
