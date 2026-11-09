import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminSupabase } from './adminAuth';
import { ID, criarAmbiente, type Ambiente } from './test-support';

let amb: Ambiente;
beforeEach(async () => {
  amb = await criarAmbiente();
});

const novo = (extra: object = {}) => ({ nome: 'Rita Alves', email: 'rita@ma.com.br', senha: 'senha-segura-1', papel: 'atendimento', ...extra });
const criar = (corpo: object = novo(), quem: string | null = ID.admin) => amb.chamar(quem, '/usuarios', corpo);
const erroDe = async (r: Response) => ((await r.json()) as { erro: string }).erro;

describe('criar usuário (RF-04)', () => {
  it('cria o login e o perfil, e a pessoa já consegue entrar com o papel certo', async () => {
    const r = await criar(novo({ nome: 'Rita Alves', papel: 'setor', setor: 'Laser' }));
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };

    expect(amb.auth.criados).toEqual([{ id, email: 'rita@ma.com.br', senha: 'senha-segura-1', nome: 'Rita Alves' }]);
    const perfil = (await amb.pg.query('select nome, email, papel, setor, ativo from perfis where id = $1', [id])).rows[0];
    expect(perfil).toEqual({ nome: 'Rita Alves', email: 'rita@ma.com.br', papel: 'setor', setor: 'Laser', ativo: true });
    expect(await (await amb.chamar(id, '/me')).json()).toMatchObject({ papel: 'setor', setor: 'Laser' });
  });

  it('a senha nunca é gravada no banco nem devolvida', async () => {
    const r = await criar();
    const texto = await r.text();
    expect(texto).not.toContain('senha-segura-1');
    const tudo = JSON.stringify((await amb.pg.query('select * from perfis')).rows);
    expect(tudo).not.toContain('senha-segura-1');
  });

  it('quem não é de setor fica sem setor', async () => {
    await criar(novo({ papel: 'direcao' }));
    const { setor } = (await amb.pg.query<{ setor: string | null }>(`select setor from perfis where email = 'rita@ma.com.br'`)).rows[0]!;
    expect(setor).toBeNull();
  });

  it('só o administrador cria: atendimento, setor e direção recebem 403 e nada é criado', async () => {
    for (const quem of [ID.atendimento, ID.impressao, ID.direcao]) {
      expect((await criar(novo(), quem)).status).toBe(403);
    }
    expect((await criar(novo(), null)).status).toBe(401);
    expect(amb.auth.criados).toHaveLength(0);
  });

  it.each([
    ['e-mail inválido', { email: 'rita' }, /e-mail/i],
    ['senha curta', { senha: '1234567' }, /pelo menos 8/],
    ['setor sem setor', { papel: 'setor' }, /setor/i],
    ['setor que não existe', { papel: 'setor', setor: 'Cozinha' }, /./],
    ['papel desconhecido', { papel: 'chefe' }, /./],
  ])('recusa %s: 400 e nada é criado', async (_nome, extra, mensagem) => {
    const r = await criar(novo(extra));
    expect(r.status).toBe(400);
    expect(await erroDe(r)).toMatch(mensagem);
    expect(amb.auth.criados).toHaveLength(0);
  });

  it('e-mail que já tem perfil: 409 (sem diferenciar maiúsculas) e não chama o login', async () => {
    await criar();
    const r = await criar(novo({ nome: 'Outra Pessoa', email: 'RITA@ma.com.br' }));
    expect(r.status).toBe(409);
    expect(await erroDe(r)).toMatch(/Rita Alves/);
    expect(amb.auth.criados).toHaveLength(1);
  });

  it('o Supabase recusa e-mail repetido ou senha fraca: 409 e 400, sem criar perfil', async () => {
    amb.auth.falha = 'email_existente';
    expect((await criar()).status).toBe(409);
    amb.auth.falha = 'senha_fraca';
    const r = await criar();
    expect(r.status).toBe(400);
    expect(await erroDe(r)).toMatch(/senha/i);
    expect((await amb.pg.query(`select 1 from perfis where email = 'rita@ma.com.br'`)).rows).toHaveLength(0);
  });

  it('o Supabase fora do ar: 500 sem detalhes e nenhum perfil', async () => {
    amb.auth.falha = 'erro';
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await criar();
    erro.mockRestore();
    expect(r.status).toBe(500);
    expect(await erroDe(r)).not.toMatch(/Supabase/);
    expect((await amb.pg.query(`select 1 from perfis where email = 'rita@ma.com.br'`)).rows).toHaveLength(0);
  });

  it('se o perfil não puder ser gravado, o login recém-criado é desfeito', async () => {
    await amb.pg.exec(`
      create function boom() returns trigger language plpgsql as $$ begin raise exception 'falha de teste'; end $$;
      create trigger boom before insert on perfis for each row execute function boom();
    `);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await criar();
    erro.mockRestore();
    expect(r.status).toBe(500);
    expect(amb.auth.criados).toHaveLength(1);
    expect(amb.auth.apagados).toEqual([amb.auth.criados[0]!.id]);
    expect((await amb.pg.query('select 1 from auth.users where id = $1', [amb.auth.criados[0]!.id])).rows).toHaveLength(0);
  });
});

describe('listar usuários', () => {
  it('o administrador vê todos, os ativos primeiro; os outros recebem 403', async () => {
    const { id } = (await (await criar()).json()) as { id: string };
    await amb.chamar(ID.admin, `/usuarios/${id}/ativo`, { ativo: false });
    const { usuarios } = (await (await amb.chamar(ID.admin, '/usuarios')).json()) as { usuarios: { nome: string; ativo: boolean }[] };
    expect(usuarios.at(-1)).toMatchObject({ nome: 'Rita Alves', ativo: false });
    expect(usuarios.slice(0, -1).every((u) => u.ativo)).toBe(true);
    expect(usuarios).toHaveLength(8);
    for (const quem of [ID.atendimento, ID.impressao, ID.direcao]) {
      expect((await amb.chamar(quem, '/usuarios')).status).toBe(403);
    }
  });
});

describe('ativar e desativar', () => {
  it('desativar barra a pessoa na hora (403), sem apagar nada; reativar devolve o acesso', async () => {
    expect((await amb.chamar(ID.impressao, '/fila')).status).toBe(200);
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.impressao}/ativo`, { ativo: false })).status).toBe(200);
    expect((await amb.chamar(ID.impressao, '/fila')).status).toBe(403);
    expect((await amb.pg.query('select 1 from perfis where id = $1', [ID.impressao])).rows).toHaveLength(1);
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.impressao}/ativo`, { ativo: true })).status).toBe(200);
    expect((await amb.chamar(ID.impressao, '/fila')).status).toBe(200);
  });

  it('o administrador não desativa a si mesmo: 409', async () => {
    const r = await amb.chamar(ID.admin, `/usuarios/${ID.admin}/ativo`, { ativo: false });
    expect(r.status).toBe(409);
    expect((await amb.chamar(ID.admin, '/fila')).status).toBe(200);
  });

  it('só o administrador; usuário que não existe: 404; id malformado: 400', async () => {
    expect((await amb.chamar(ID.atendimento, `/usuarios/${ID.impressao}/ativo`, { ativo: false })).status).toBe(403);
    expect((await amb.chamar(ID.impressao, '/fila')).status).toBe(200);
    expect((await amb.chamar(ID.admin, '/usuarios/00000000-0000-0000-0000-000000000000/ativo', { ativo: false })).status).toBe(404);
    expect((await amb.chamar(ID.admin, '/usuarios/xyz/ativo', { ativo: false })).status).toBe(400);
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.impressao}/ativo`, { ativo: 'sim' })).status).toBe(400);
  });
});

describe('trocar senha (D13)', () => {
  it('o administrador define uma nova senha; a antiga deixa de valer no login', async () => {
    const { id } = (await (await criar()).json()) as { id: string };
    const r = await amb.chamar(ID.admin, `/usuarios/${id}/senha`, { senha: 'nova-senha-2' });
    expect(r.status).toBe(200);
    expect(amb.auth.senhas.get(id)).toBe('nova-senha-2');
    expect(await r.text()).not.toContain('nova-senha-2');
  });

  it('senha curta: 400; senha fraca segundo o Supabase: 400; usuário sem perfil: 404; sem permissão: 403', async () => {
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.impressao}/senha`, { senha: 'curta' })).status).toBe(400);
    amb.auth.falha = 'senha_fraca';
    expect((await amb.chamar(ID.admin, `/usuarios/${ID.impressao}/senha`, { senha: 'senha-longa-ok' })).status).toBe(400);
    amb.auth.falha = null;
    expect((await amb.chamar(ID.admin, '/usuarios/00000000-0000-0000-0000-000000000000/senha', { senha: 'senha-longa-ok' })).status).toBe(404);
    expect((await amb.chamar(ID.atendimento, `/usuarios/${ID.impressao}/senha`, { senha: 'senha-longa-ok' })).status).toBe(403);
    expect(amb.auth.senhas.has(ID.impressao)).toBe(false);
  });
});

describe('cliente do Supabase Auth (adminSupabase), com respostas simuladas', () => {
  // Chave antiga (service_role) é um JWT; a nova (sb_secret_…) não é.
  const CHAVE = 'eyJchave-secreta-service-role';
  const chamadas: { url: string; init: RequestInit }[] = [];

  function responder(status: number, corpo: object) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        chamadas.push({ url, init });
        return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  }

  beforeEach(() => {
    chamadas.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cria com e-mail confirmado, a chave nos cabeçalhos e a senha só no corpo', async () => {
    responder(200, { id: 'abc-123' });
    const r = await adminSupabase('https://x.supabase.co/', CHAVE).criar({ email: 'a@b.com', senha: 'senha-segura-1', nome: 'A' });
    expect(r).toEqual({ ok: true, id: 'abc-123' });
    const { url, init } = chamadas[0]!;
    expect(url).toBe('https://x.supabase.co/auth/v1/admin/users');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: CHAVE, Authorization: `Bearer ${CHAVE}` });
    expect(JSON.parse(init.body as string)).toMatchObject({ email: 'a@b.com', password: 'senha-segura-1', email_confirm: true });
  });

  it('com a chave nova (sb_secret_…), manda só o cabeçalho apikey, sem Authorization', async () => {
    responder(200, { id: 'abc-123' });
    await adminSupabase('https://x.supabase.co', 'sb_secret_abc').criar({ email: 'a@b.com', senha: 'senha-segura-1', nome: 'A' });
    const headers = chamadas[0]!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_secret_abc');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it.each([
    [422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, 'email_existente'],
    [422, { msg: 'User already registered' }, 'email_existente'],
    [422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }, 'senha_fraca'],
  ])('entende a recusa %#', async (status, corpo, motivo) => {
    responder(status, corpo);
    const r = await adminSupabase('https://x.supabase.co', CHAVE).criar({ email: 'a@b.com', senha: 'x', nome: 'A' });
    expect(r).toEqual({ ok: false, motivo });
  });

  it('erro desconhecido vira exceção, e a mensagem não contém a chave secreta nem a senha', async () => {
    responder(500, { msg: 'boom', code: 500 });
    const erro = await adminSupabase('https://x.supabase.co', CHAVE)
      .criar({ email: 'a@b.com', senha: 'senha-segura-1', nome: 'A' })
      .catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/500/);
    expect((erro as Error).message).not.toContain(CHAVE);
    expect((erro as Error).message).not.toContain('senha-segura-1');
  });

  it('sem a chave configurada, não faz nenhuma chamada e explica', async () => {
    responder(200, {});
    await expect(adminSupabase('https://x.supabase.co', undefined).criar({ email: 'a@b.com', senha: 'x', nome: 'A' })).rejects.toThrow(/SERVICE_ROLE/);
    expect(chamadas).toHaveLength(0);
  });

  it('troca de senha (PUT) e remoção (DELETE); 404 ao trocar vira "não existe"; remover o que já sumiu não falha', async () => {
    const auth = adminSupabase('https://x.supabase.co', CHAVE);
    responder(200, { id: 'u1' });
    expect(await auth.trocarSenha('u1', 'nova-senha-2')).toEqual({ ok: true });
    expect(chamadas[0]!.url).toBe('https://x.supabase.co/auth/v1/admin/users/u1');
    expect(chamadas[0]!.init.method).toBe('PUT');
    expect(JSON.parse(chamadas[0]!.init.body as string)).toEqual({ password: 'nova-senha-2' });

    responder(404, { msg: 'User not found' });
    expect(await auth.trocarSenha('u2', 'nova-senha-2')).toEqual({ ok: false, motivo: 'nao_existe' });
    await expect(auth.apagar('u2')).resolves.toBeUndefined();
    expect(chamadas.at(-1)!.init.method).toBe('DELETE');

    responder(500, {});
    await expect(auth.apagar('u3')).rejects.toThrow(/500/);
  });
});

describe('editar usuário (RF-04)', () => {
  const editar = (id: string, corpo: object, quem: string | null = ID.admin) => amb.chamar(quem, `/usuarios/${id}`, corpo);
  const alteracoes = async () =>
    (await amb.pg.query<{ perfil_id: string; alterado_por: string; antes: unknown; depois: unknown }>(
      'select perfil_id, alterado_por, antes, depois from alteracoes_usuarios order by id',
    )).rows;

  it('troca o setor: a fila e a permissão seguem o setor novo já na próxima requisição', async () => {
    const naCostura = await amb.lote({ descricao: 'Pedido da Costura', etapa: 'Costura' });
    await amb.lote({ descricao: 'Pedido do Laser', etapa: 'Laser' });
    const concluidoAntes = await amb.lote({ descricao: 'Pedido concluído', etapa: 'Costura' });
    expect((await amb.chamar(ID.costura, `/lotes/${concluidoAntes}/concluir`, { versao: 1 })).status).toBe(200);

    const r = await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Laser' });
    expect(r.status).toBe(200);

    const { lotes } = (await (await amb.chamar(ID.costura, '/fila')).json()) as { lotes: { descricao: string }[] };
    expect(lotes.map((l) => l.descricao)).toEqual(['Pedido do Laser']);
    expect((await amb.chamar(ID.costura, `/lotes/${naCostura}/concluir`, { versao: 1 })).status).not.toBe(200);

    const ficha = (await (await amb.chamar(ID.admin, `/lotes/${concluidoAntes}`)).json()) as { historico: { por: string }[] };
    expect(ficha.historico.map((h) => h.por)).toContain('João');

    expect(await alteracoes()).toEqual([
      { perfil_id: ID.costura, alterado_por: ID.admin, antes: { setor: 'Costura' }, depois: { setor: 'Laser' } },
    ]);
  });

  it('não muda e-mail nem situação', async () => {
    await amb.chamar(ID.admin, `/usuarios/${ID.costura}/ativo`, { ativo: false });
    await editar(ID.costura, { nome: 'João Silva', papel: 'setor', setor: 'Costura', email: 'outro@x.com', ativo: true });
    const p = (await amb.pg.query('select nome, email, ativo from perfis where id = $1', [ID.costura])).rows[0];
    expect(p).toEqual({ nome: 'João Silva', email: 'costura@teste.local', ativo: false });
  });

  it('sem mudança: 200 e nada no registro', async () => {
    expect((await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Costura' })).status).toBe(200);
    expect(await alteracoes()).toEqual([]);
  });

  it('só o administrador edita: os demais recebem 403 e nada muda', async () => {
    for (const quem of [ID.atendimento, ID.direcao, ID.impressao]) {
      const r = await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Laser' }, quem);
      expect(r.status).toBe(403);
      expect(await erroDe(r)).toBe('Só o Administrador gerencia usuários.');
    }
    expect((await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Laser' }, null)).status).toBe(401);
    expect(await alteracoes()).toEqual([]);
  });

  it('usuário que não existe: 404; endereço inválido e corpo inválido: 400', async () => {
    expect((await editar('00000000-0000-0000-0000-000000000000', { nome: 'Fulano', papel: 'admin' })).status).toBe(404);
    expect((await editar('xyz', { nome: 'Fulano', papel: 'admin' })).status).toBe(400);
    const r = await editar(ID.costura, { nome: 'João', papel: 'setor' });
    expect(r.status).toBe(400);
    expect(await erroDe(r)).toMatch(/Escolha o setor/);
  });

  it('o banco recusa alterar ou apagar o registro', async () => {
    await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Laser' });
    await expect(amb.pg.query(`update alteracoes_usuarios set antes = '{}'`)).rejects.toThrow(/não pode ser alterado/);
    await expect(amb.pg.query('delete from alteracoes_usuarios')).rejects.toThrow(/não pode ser alterado/);
    await expect(amb.pg.query('truncate alteracoes_usuarios')).rejects.toThrow(/não pode ser alterado/);
  });
});

describe('editar o papel e o nome (RF-04)', () => {
  const editar = (id: string, corpo: object, quem: string = ID.admin) => amb.chamar(quem, `/usuarios/${id}`, corpo);
  const perfil = async (id: string) =>
    (await amb.pg.query('select nome, papel, setor, gerencia_precos from perfis where id = $1', [id])).rows[0];

  it('setor vira Atendimento: perde o setor e passa a ver clientes', async () => {
    expect((await amb.chamar(ID.costura, '/clientes')).status).toBe(403);
    expect((await editar(ID.costura, { nome: 'João', papel: 'atendimento' })).status).toBe(200);
    expect(await perfil(ID.costura)).toMatchObject({ papel: 'atendimento', setor: null });
    expect((await amb.chamar(ID.costura, '/clientes')).status).toBe(200);
  });

  it('sair do Atendimento tira a permissão de gerenciar preços, e isso entra no registro', async () => {
    await amb.pg.query('update perfis set gerencia_precos = true where id = $1', [ID.atendimento]);
    expect((await editar(ID.atendimento, { nome: 'Atendimento', papel: 'direcao' })).status).toBe(200);
    expect(await perfil(ID.atendimento)).toMatchObject({ papel: 'direcao', gerencia_precos: false });
    const [linha] = (await amb.pg.query('select antes, depois from alteracoes_usuarios')).rows;
    expect(linha).toEqual({
      antes: { papel: 'atendimento', gerenciaPrecos: true },
      depois: { papel: 'direcao', gerenciaPrecos: false },
    });
  });

  it('o administrador não tira de si o papel de Administrador: 409 e nada gravado', async () => {
    const r = await editar(ID.admin, { nome: 'Admin', papel: 'direcao' });
    expect(r.status).toBe(409);
    expect(await erroDe(r)).toBe('Você não pode tirar de si o papel de Administrador.');
    expect(await perfil(ID.admin)).toMatchObject({ papel: 'admin' });
    expect((await amb.pg.query('select 1 from alteracoes_usuarios')).rows).toHaveLength(0);
    expect((await editar(ID.admin, { nome: 'Admin Geral', papel: 'admin' })).status).toBe(200);
  });

  it('nome curto é recusado; nome novo aparece em /me e na ficha, sem espaços nas pontas', async () => {
    const r = await editar(ID.costura, { nome: 'J', papel: 'setor', setor: 'Costura' });
    expect(r.status).toBe(400);
    expect(await erroDe(r)).toBe('Informe o nome da pessoa.');

    const lote = await amb.lote({ descricao: 'Pedido', etapa: 'Costura' });
    expect((await amb.chamar(ID.costura, `/lotes/${lote}/concluir`, { versao: 1 })).status).toBe(200);
    await editar(ID.costura, { nome: '  João Pereira  ', papel: 'setor', setor: 'Costura' });
    expect(await (await amb.chamar(ID.costura, '/me')).json()).toMatchObject({ nome: 'João Pereira' });
    const ficha = (await (await amb.chamar(ID.admin, `/lotes/${lote}`)).json()) as { historico: { por: string }[] };
    expect(ficha.historico.map((h) => h.por)).toContain('João Pereira');
  });
});

describe('alterações de um usuário (RF-04)', () => {
  const editar = (id: string, corpo: object) => amb.chamar(ID.admin, `/usuarios/${id}`, corpo);
  const ver = (id: string, quem: string = ID.admin) => amb.chamar(quem, `/usuarios/${id}/alteracoes`);

  it('lista a mais recente primeiro, com quem alterou, antes e depois', async () => {
    await editar(ID.costura, { nome: 'João', papel: 'setor', setor: 'Laser' });
    await editar(ID.costura, { nome: 'João', papel: 'atendimento' });
    const r = await ver(ID.costura);
    expect(r.status).toBe(200);
    const { alteracoes } = (await r.json()) as { alteracoes: { alteradoPor: string; antes: object; depois: object; criadoEm: string }[] };
    expect(alteracoes.map(({ alteradoPor, antes, depois }) => ({ alteradoPor, antes, depois }))).toEqual([
      { alteradoPor: 'Admin', antes: { papel: 'setor', setor: 'Laser' }, depois: { papel: 'atendimento', setor: null } },
      { alteradoPor: 'Admin', antes: { setor: 'Costura' }, depois: { setor: 'Laser' } },
    ]);
    expect(alteracoes[0]!.criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('nunca editado: lista vazia', async () => {
    expect(await (await ver(ID.laser)).json()).toEqual({ alteracoes: [] });
  });

  it('só o administrador vê; usuário que não existe: 404; endereço inválido: 400', async () => {
    for (const quem of [ID.atendimento, ID.direcao, ID.costura]) expect((await ver(ID.costura, quem)).status).toBe(403);
    expect((await ver('00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await ver('xyz')).status).toBe(400);
  });
});
