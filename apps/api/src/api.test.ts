import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

// Atalhos para o ambiente da vez, para os testes ficarem curtos.
const pg = {
  query: ((...a: Parameters<PGlite['query']>) => amb.pg.query(...a)) as PGlite['query'],
  exec: (sql: string) => amb.pg.exec(sql),
};
const lote = (...a: Parameters<Ambiente['lote']>) => amb.lote(...a);
const chamar = (...a: Parameters<Ambiente['chamar']>) => amb.chamar(...a);

describe('login e perfil', () => {
  it('sem crachá: 401', async () => {
    expect((await chamar(null, '/fila')).status).toBe(401);
  });

  it('toda rota, menos /health, exige login', async () => {
    // Os middlewares (CORS e login) ficam em '/*'; todo o resto é rota, inclusive as de app.all.
    const rotas = amb.rotas.filter((r) => r.path !== '/*' && r.path !== '/health');
    expect(rotas.length).toBeGreaterThan(20);
    for (const r of rotas) {
      const caminho = r.path.replace(/:id/g, '00000000-0000-4000-8000-000000000000');
      const metodo = r.method === 'ALL' ? 'GET' : r.method;
      const resposta = await amb.fetch(new Request(`http://api${caminho}`, { method: metodo }));
      expect(resposta.status, `${r.method} ${r.path}`).toBe(401);
    }
    expect((await chamar(null, '/health')).status).toBe(200);
  });

  it('o pré-voo do navegador (OPTIONS) passa sem login', async () => {
    const r = await amb.fetch(
      new Request('http://api/fila', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
      }),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('crachá inválido: 401', async () => {
    expect((await chamar('qualquer-coisa', '/fila')).status).toBe(401);
  });

  it('usuário autenticado sem perfil: 403', async () => {
    expect((await chamar(ID.semPerfil, '/fila')).status).toBe(403);
  });

  it('perfil desativado: 403', async () => {
    await pg.query('update perfis set ativo = false where id = $1', [ID.impressao]);
    expect((await chamar(ID.impressao, '/fila')).status).toBe(403);
  });

  it('/me devolve papel e setor do banco', async () => {
    const r = await chamar(ID.impressao, '/me');
    expect(await r.json()).toMatchObject({ nome: 'Maria', papel: 'setor', setor: 'Impressão' });
  });
});

describe('fila', () => {
  it('o setor vê só os pedidos da sua etapa, do mais urgente ao menos', async () => {
    await lote({ descricao: 'normal', etapa: 'Impressão', prioridade: 'Normal', entrega: '2026-11-01' });
    await lote({ descricao: 'urgente', etapa: 'Impressão', prioridade: 'Urgente', entrega: '2026-11-09' });
    await lote({ descricao: 'de outro setor', etapa: 'Costura' });
    const { lotes } = (await (await chamar(ID.impressao, '/fila')).json()) as { lotes: { descricao: string }[] };
    expect(lotes.map((l) => l.descricao)).toEqual(['urgente', 'normal']);
  });

  it('o atendimento vê todas as etapas em aberto, e não os concluídos', async () => {
    await lote({ descricao: 'a', etapa: 'Impressão' });
    await lote({ descricao: 'b', etapa: 'Costura' });
    await lote({ descricao: 'c', etapa: 'Concluído' });
    const { lotes } = (await (await chamar(ID.atendimento, '/fila')).json()) as { lotes: unknown[] };
    expect(lotes).toHaveLength(2);
  });

  it('a direção vê todas as etapas, com os valores (só leitura)', async () => {
    await lote({ descricao: 'a', etapa: 'Impressão' });
    await lote({ descricao: 'b', etapa: 'Costura' });
    const r = await chamar(ID.direcao, '/fila');
    expect(r.status).toBe(200);
    const { lotes } = (await r.json()) as { lotes: Record<string, unknown>[] };
    expect(lotes.map((l) => l.descricao).sort()).toEqual(['a', 'b']);
    expect(lotes[0]).toHaveProperty('totalCentavos');
    expect((await chamar(ID.direcao, '/fila?aba=concluidos')).status).toBe(200);
  });

  it('a data de entrega sai como AAAA-MM-DD', async () => {
    await lote({ descricao: 'a', etapa: 'Impressão', entrega: '2026-11-09' });
    const { lotes } = (await (await chamar(ID.impressao, '/fila')).json()) as { lotes: { dataEntrega: string }[] };
    expect(lotes[0]!.dataEntrega).toBe('2026-11-09');
  });
});

describe('concluir etapa', () => {
  it('conclui, avança a etapa, sobe a versão e grava o histórico com quem fez', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1, maquina: '03', nota: 'ok' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ etapa: 'Batida', versao: 2 });

    const h = await pg.query<{ etapa: string; maquina: string; nota: string; usuario_id: string }>('select * from historico');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ etapa: 'Impressão', maquina: '03', nota: 'ok', usuario_id: ID.impressao });
  });

  it('dois cliques ao mesmo tempo: um vale (200) e o outro é recusado (409), com um só histórico', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    const corpo = { versao: 1, maquina: '02' };
    const respostas = await Promise.all([
      chamar(ID.impressao, `/lotes/${id}/concluir`, corpo),
      chamar(ID.impressao, `/lotes/${id}/concluir`, corpo),
    ]);
    expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await pg.query('select 1 from historico')).rows).toHaveLength(1);
    expect((await pg.query<{ etapa: string }>('select etapa from lotes where id = $1', [id])).rows[0]!.etapa).toBe('Batida');
  });

  it('versão desatualizada: 409 e nada muda', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 7, maquina: '02' });
    expect(r.status).toBe(409);
    expect((await pg.query('select 1 from historico')).rows).toHaveLength(0);
  });

  it('setor de outra etapa: 403', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Costura' });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1, maquina: '02' });
    expect(r.status).toBe(403);
    expect((await pg.query('select 1 from historico')).rows).toHaveLength(0);
  });

  it('direção e atendimento não concluem etapa: 403', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    expect((await chamar(ID.direcao, `/lotes/${id}/concluir`, { versao: 1, maquina: '02' })).status).toBe(403);
    expect((await chamar(ID.atendimento, `/lotes/${id}/concluir`, { versao: 1, maquina: '02' })).status).toBe(403);
  });

  it('a Impressão exige a máquina: 400', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1 });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { erro: string }).erro).toMatch(/máquina/);
  });

  it('pedido inexistente: 404; identificador malformado: 400', async () => {
    expect((await chamar(ID.impressao, '/lotes/00000000-0000-0000-0000-000000000000/concluir', { versao: 1, maquina: '02' })).status).toBe(404);
    expect((await chamar(ID.impressao, '/lotes/xyz/concluir', { versao: 1 })).status).toBe(400);
  });

  it('corpo inválido: 400', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Impressão' });
    expect((await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 'x' })).status).toBe(400);
  });

  it('a Conferência sem bordado pula para a Costura', async () => {
    await pg.query(`update perfis set setor = 'Conferência' where id = $1`, [ID.impressao]);
    const id = await lote({ descricao: 'a', etapa: 'Conferência', bordado: false });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1 });
    expect(((await r.json()) as { etapa: string }).etapa).toBe('Costura');
  });

  it('a Embalagem exige as peças; Cliente vai ao Financeiro e a quantidade fica gravada', async () => {
    await pg.query(`update perfis set setor = 'Embalagem' where id = $1`, [ID.impressao]);
    const id = await lote({ descricao: 'a', etapa: 'Embalagem', tipo: 'Cliente' });
    expect((await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1 })).status).toBe(400);
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1, pecas: 18 });
    expect(((await r.json()) as { etapa: string }).etapa).toBe('Financeiro');
    expect((await pg.query<{ entregue: number }>('select entregue from lotes where id = $1', [id])).rows[0]!.entregue).toBe(18);
  });

  it('a Embalagem de Feira conclui o pedido e marca a data de fim', async () => {
    await pg.query(`update perfis set setor = 'Embalagem' where id = $1`, [ID.impressao]);
    const id = await lote({ descricao: 'a', etapa: 'Embalagem', tipo: 'Feira' });
    await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1, pecas: 20 });
    const l = (await pg.query<{ etapa: string; finalizado_em: unknown }>('select etapa, finalizado_em from lotes where id = $1', [id])).rows[0]!;
    expect(l.etapa).toBe('Concluído');
    expect(l.finalizado_em).not.toBeNull();
  });

  it('o Design que conclui uma recuperação limpa a marca e volta para a Impressão', async () => {
    await pg.query(`update perfis set setor = 'Design' where id = $1`, [ID.impressao]);
    const id = await lote({ descricao: 'a', etapa: 'Design', recuperacao: true });
    const r = await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1 });
    expect(((await r.json()) as { etapa: string }).etapa).toBe('Impressão');
    expect((await pg.query<{ recuperacao_pendente: boolean }>('select recuperacao_pendente from lotes where id = $1', [id])).rows[0]!.recuperacao_pendente).toBe(false);
  });

  it('máquina e peças enviadas fora da Impressão e da Embalagem não vão para o histórico', async () => {
    await pg.query(`update perfis set setor = 'Laser' where id = $1`, [ID.impressao]);
    const id = await lote({ descricao: 'a', etapa: 'Laser' });
    expect((await chamar(ID.impressao, `/lotes/${id}/concluir`, { versao: 1, maquina: '02', pecas: 20 })).status).toBe(200);
    const h = (await pg.query<{ maquina: string | null; pecas: number | null }>('select maquina, pecas from historico')).rows[0]!;
    expect(h).toEqual({ maquina: null, pecas: null });
    const l = (await pg.query<{ entregue: number | null }>('select entregue from lotes where id = $1', [id])).rows[0]!;
    expect(l.entregue).toBeNull();
  });

  it('o administrador pode concluir qualquer etapa', async () => {
    const id = await lote({ descricao: 'a', etapa: 'Costura' });
    expect((await chamar(ID.admin, `/lotes/${id}/concluir`, { versao: 1 })).status).toBe(200);
  });
});

describe('o banco fecha o acesso à chave pública', () => {
  it('anon e authenticated não têm permissão nas tabelas', async () => {
    await pg.exec(`create role leitor_publico`);
    for (const papel of ['anon', 'authenticated']) {
      const r = await pg.query<{ tabela: string; pode: boolean }>(
        `select t as tabela, has_table_privilege($1, 'public.' || t, 'select') as pode
           from unnest(array['perfis','clientes','lotes','itens_pedido','historico','acessos_dados_pessoais']) as t`,
        [papel],
      );
      expect(r.rows.filter((x) => x.pode)).toEqual([]);
    }
  });
});
