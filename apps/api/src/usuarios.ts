import {
  gerenciaUsuarios,
  mudancasDoUsuario,
  podeEditarUsuario,
  type AlteracaoUsuario,
  type CamposEditaveis,
  type EdicaoUsuarioBody,
  type Perfil,
  type UsuarioBody,
  type UsuarioLinha,
} from '@pcp/shared';
import type { AdminAuth } from './adminAuth';
import type { Db } from './db';
import type { Falha } from './lote';

const SO_ADMIN: Falha = { ok: false, status: 403, erro: 'Só o Administrador gerencia usuários.' };

/** RF-04: todos os usuários, os ativos primeiro. */
export async function listarUsuarios(db: Db, perfil: Perfil): Promise<{ ok: true; usuarios: UsuarioLinha[] } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  const usuarios = await db.query<UsuarioLinha>('select id, nome, email, papel, setor, ativo, gerencia_precos as "gerenciaPrecos" from perfis order by ativo desc, nome');
  return { ok: true, usuarios };
}

/**
 * RF-04: cria o acesso de uma pessoa (login no Supabase Auth + perfil com papel e setor).
 * São dois sistemas, então não há transação única: se o perfil não puder ser gravado, o login recém-criado é desfeito,
 * para não sobrar um usuário que entra mas não tem perfil.
 */
export async function criarUsuario(
  db: Db,
  auth: AdminAuth,
  perfil: Perfil,
  body: UsuarioBody,
): Promise<{ ok: true; id: string } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;

  const [igual] = await db.query<{ nome: string }>('select nome from perfis where lower(email) = $1', [body.email]);
  if (igual) return { ok: false, status: 409, erro: `Já existe um usuário com este e-mail: ${igual.nome}.` };

  const criado = await auth.criar({ email: body.email, senha: body.senha, nome: body.nome });
  if (!criado.ok) {
    return criado.motivo === 'email_existente'
      ? { ok: false, status: 409, erro: 'Este e-mail já tem um login no sistema.' }
      : { ok: false, status: 400, erro: 'A senha é fraca demais. Escolha outra, maior e menos óbvia.' };
  }

  try {
    await db.query('insert into perfis (id, nome, email, papel, setor) values ($1, $2, $3, $4, $5)', [
      criado.id,
      body.nome,
      body.email,
      body.papel,
      body.papel === 'setor' ? (body.setor ?? null) : null,
    ]);
  } catch (erro) {
    await auth.apagar(criado.id).catch((e) => console.error('Não foi possível desfazer o login criado', e));
    throw erro;
  }
  return { ok: true, id: criado.id };
}

/**
 * RF-04: ativa ou desativa o acesso. Desativar não apaga nada: o histórico continua mostrando quem fez cada etapa.
 * O administrador não desativa a si mesmo, para o sistema nunca ficar sem quem o administre.
 */
export async function mudarAtivo(db: Db, perfil: Perfil, id: string, ativo: boolean): Promise<{ ok: true } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  if (!ativo && id === perfil.id) {
    return { ok: false, status: 409, erro: 'Você não pode desativar o seu próprio acesso.' };
  }
  const feito = await db.query('update perfis set ativo = $2 where id = $1 returning id', [id, ativo]);
  if (feito.length === 0) return { ok: false, status: 404, erro: 'Usuário não encontrado.' };
  return { ok: true };
}

/**
 * RN-11: o Administrador escolhe quais pessoas do Atendimento também gerenciam preços. O Administrador já pode pelo papel,
 * e setor e Direção nunca recebem esta permissão (o banco também recusa).
 */
export async function mudarGerenciaPrecos(db: Db, perfil: Perfil, id: string, gerenciaPrecos: boolean): Promise<{ ok: true } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  const [alvo] = await db.query<{ papel: string }>('select papel from perfis where id = $1', [id]);
  if (!alvo) return { ok: false, status: 404, erro: 'Usuário não encontrado.' };
  if (gerenciaPrecos && alvo.papel !== 'atendimento') {
    return { ok: false, status: 400, erro: 'Só as pessoas do Atendimento podem receber a permissão de gerenciar preços.' };
  }
  await db.query('update perfis set gerencia_precos = $2 where id = $1', [id, gerenciaPrecos]);
  return { ok: true };
}

/**
 * RF-04: muda nome, papel e setor de quem já existe e grava o que mudou em `alteracoes_usuarios` (migração 006), na
 * mesma transação. Papel e setor são lidos do `perfis` a cada requisição, então a mudança vale na próxima.
 */
export async function editarUsuario(db: Db, perfil: Perfil, id: string, body: EdicaoUsuarioBody): Promise<{ ok: true } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  if (!podeEditarUsuario(perfil.id, id, body.papel)) {
    return { ok: false, status: 409, erro: 'Você não pode tirar de si o papel de Administrador.' };
  }
  return db.transaction(async (tx) => {
    // "for update": duas edições ao mesmo tempo entram em fila; vale a última.
    const [atual] = await tx.query<CamposEditaveis>(
      'select nome, papel, setor, gerencia_precos as "gerenciaPrecos" from perfis where id = $1 for update',
      [id],
    );
    if (!atual) return { ok: false, status: 404, erro: 'Usuário não encontrado.' } as const;
    const mudou = mudancasDoUsuario(atual, body);
    if (!mudou) return { ok: true } as const;
    await tx.query(
      `update perfis set nome = $2, papel = $3, setor = $4, gerencia_precos = gerencia_precos and $3 = 'atendimento' where id = $1`,
      [id, body.nome, body.papel, body.papel === 'setor' ? (body.setor ?? null) : null],
    );
    await tx.query(
      'insert into alteracoes_usuarios (perfil_id, alterado_por, antes, depois) values ($1, $2, ($3::text)::jsonb, ($4::text)::jsonb)',
      [id, perfil.id, JSON.stringify(mudou.antes), JSON.stringify(mudou.depois)],
    );
    return { ok: true } as const;
  });
}

/** RF-04: o registro de alterações de um usuário, a mais recente primeiro (só o Administrador). */
export async function listarAlteracoes(db: Db, perfil: Perfil, id: string): Promise<{ ok: true; alteracoes: AlteracaoUsuario[] } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  const [existe] = await db.query('select 1 as ok from perfis where id = $1', [id]);
  if (!existe) return { ok: false, status: 404, erro: 'Usuário não encontrado.' };
  const alteracoes = await db.query<AlteracaoUsuario>(
    `select a.id::text as id, to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "criadoEm",
            p.nome as "alteradoPor", a.antes, a.depois
       from alteracoes_usuarios a
       join perfis p on p.id = a.alterado_por
      where a.perfil_id = $1
      order by a.criado_em desc, a.id desc`,
    [id],
  );
  return { ok: true, alteracoes };
}

/** D13: quem não recebe e-mail de "esqueci a senha" tem a senha redefinida pelo Administrador. */
export async function trocarSenha(db: Db, auth: AdminAuth, perfil: Perfil, id: string, senha: string): Promise<{ ok: true } | Falha> {
  if (!gerenciaUsuarios(perfil)) return SO_ADMIN;
  const [existe] = await db.query('select 1 as ok from perfis where id = $1', [id]);
  if (!existe) return { ok: false, status: 404, erro: 'Usuário não encontrado.' };

  const r = await auth.trocarSenha(id, senha);
  if (r.ok) return { ok: true };
  if (r.motivo === 'senha_fraca') return { ok: false, status: 400, erro: 'A senha é fraca demais. Escolha outra, maior e menos óbvia.' };
  return { ok: false, status: 404, erro: 'Este usuário não existe no sistema de login.' };
}
