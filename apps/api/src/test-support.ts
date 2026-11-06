import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { criarApp } from './app';
import type { AdminAuth } from './adminAuth';
import { armazenamentoEmMemoria } from './armazenamento';
import type { Db } from './db';

/** O esquema que foi implantado (schema.sql) mais as migrações em ordem, como no banco de verdade. */
const MIGRACOES = new URL('../../../db/migracoes/', import.meta.url);
const SCHEMA = [
  readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8'),
  ...readdirSync(MIGRACOES)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .map((nome) => readFileSync(new URL(nome, MIGRACOES), 'utf8')),
].join('\n');

/** Usuários de teste. O "token" de teste é o próprio id. */
export const ID = {
  atendimento: '00000000-0000-0000-0000-0000000000a1',
  impressao: '00000000-0000-0000-0000-0000000000a2',
  costura: '00000000-0000-0000-0000-0000000000a3',
  direcao: '00000000-0000-0000-0000-0000000000a4',
  admin: '00000000-0000-0000-0000-0000000000a5',
  semPerfil: '00000000-0000-0000-0000-0000000000a6',
  laser: '00000000-0000-0000-0000-0000000000a7',
  design: '00000000-0000-0000-0000-0000000000a8',
};

function adaptar(pg: PGlite): Db {
  return {
    query: async (texto, params) => (await pg.query(texto, params)).rows as never,
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: async (texto, params) => (await tx.query(texto, params)).rows as never })),
  };
}

export interface CamposDoLote {
  descricao: string;
  etapa: string;
  tipo?: string;
  bordado?: boolean;
  prioridade?: string;
  entrega?: string;
  recuperacao?: boolean;
  /** Valor do pedido em centavos (padrão 0). */
  total?: number;
}

/** O Supabase Auth de mentira: o que foi criado, trocado e apagado, e como fazê-lo recusar ou falhar. */
export interface AuthDeMentira {
  criados: { id: string; email: string; senha: string; nome: string }[];
  senhas: Map<string, string>;
  apagados: string[];
  /** Próxima chamada: recusa (e-mail repetido, senha fraca) ou erro de verdade. `null` = funciona. */
  falha: null | 'email_existente' | 'senha_fraca' | 'erro';
}

export interface Ambiente {
  pg: PGlite;
  auth: AuthDeMentira;
  /** Liga ou desliga uma falha no armazenamento (como o R2 fora do ar) para testar o que acontece nesse caso. */
  simularFalhaNoArmazenamento(ligada: boolean): void;
  /** As fotos guardadas (em memória), para conferir o que foi gravado. */
  arquivos: Map<string, { dados: ArrayBuffer; tipo: string }>;
  /** Envia uma foto como o usuário `quem` (o corpo é a imagem). */
  enviarFoto(quem: string | null, loteId: string, bytes: Uint8Array, opcoes?: { tipo?: string; nome?: string }): Response | Promise<Response>;
  /** Entrada HTTP da API, para servir em um servidor de verdade (ver `dev-local.ts`). */
  fetch(pedido: Request): Response | Promise<Response>;
  /** Chama a API como o usuário `quem` (um valor de `ID`), ou sem login (`null`). */
  chamar(quem: string | null, caminho: string, corpo?: unknown): Response | Promise<Response>;
  /** Insere um pedido direto no banco (atalho para montar o cenário). */
  lote(campos: CamposDoLote): Promise<string>;
  /** Todas as rotas registradas na API (método e caminho). */
  rotas: { method: string; path: string }[];
}

/** Um Postgres novo em memória, com o `db/schema.sql` real, os perfis de teste e a API ligada a ele. */
export async function criarAmbiente(): Promise<Ambiente> {
  const pg = new PGlite();
  // O Supabase já traz o schema auth e os papéis anon/authenticated; aqui criamos o mínimo para o esquema rodar.
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
  `);
  await pg.exec(SCHEMA);
  for (const id of Object.values(ID)) await pg.query('insert into auth.users (id) values ($1)', [id]);
  await pg.exec(`
    insert into perfis (id, nome, email, papel, setor) values
      ('${ID.atendimento}', 'Atendimento', 'atendimento@teste.local', 'atendimento', null),
      ('${ID.impressao}', 'Maria', 'impressao@teste.local', 'setor', 'Impressão'),
      ('${ID.costura}', 'João', 'costura@teste.local', 'setor', 'Costura'),
      ('${ID.direcao}', 'Direção', 'direcao@teste.local', 'direcao', null),
      ('${ID.admin}', 'Admin', 'admin@teste.local', 'admin', null),
      ('${ID.laser}', 'Lúcia', 'laser@teste.local', 'setor', 'Laser'),
      ('${ID.design}', 'Davi', 'design@teste.local', 'setor', 'Design');
  `);

  const db = adaptar(pg);
  const auth: AuthDeMentira = { criados: [], senhas: new Map(), apagados: [], falha: null };
  const adminAuth: AdminAuth = {
    async criar({ email, senha, nome }) {
      if (auth.falha === 'erro') throw new Error('Supabase Auth fora do ar');
      if (auth.falha) return { ok: false, motivo: auth.falha };
      const id = crypto.randomUUID();
      await pg.query('insert into auth.users (id) values ($1)', [id]);
      auth.criados.push({ id, email, senha, nome });
      auth.senhas.set(id, senha);
      return { ok: true, id };
    },
    async trocarSenha(id, senha) {
      if (auth.falha === 'erro') throw new Error('Supabase Auth fora do ar');
      if (auth.falha) return { ok: false, motivo: auth.falha };
      const { rows } = await pg.query('select 1 from auth.users where id = $1', [id]);
      if (rows.length === 0) return { ok: false, motivo: 'nao_existe' };
      auth.senhas.set(id, senha);
      return { ok: true };
    },
    async apagar(id) {
      auth.apagados.push(id);
      await pg.query('delete from auth.users where id = $1', [id]);
    },
  };
  const arquivos = armazenamentoEmMemoria();
  let armazenamentoFalha = false;
  const armazenamento = {
    ...arquivos,
    async guardar(chave: string, dados: ArrayBuffer, tipo: string) {
      if (armazenamentoFalha) throw new Error('R2 fora do ar');
      await arquivos.guardar(chave, dados, tipo);
    },
  };
  const app = criarApp<{ CORS_ORIGIN?: string }>({
    // O "token" de teste é o id do usuário; vale para os usuários fixos e para os criados durante o teste.
    verificarToken: async (token) => {
      const { rows } = await pg.query('select 1 from auth.users where id::text = $1', [token]);
      if (rows.length === 0) throw new Error('token inválido');
      return token;
    },
    abrirDb: () => ({ db, fechar: async () => {} }),
    armazenamento: () => armazenamento,
    adminAuth: () => adminAuth,
  });

  return {
    pg,
    auth,
    simularFalhaNoArmazenamento(ligada) {
      armazenamentoFalha = ligada;
    },
    arquivos: arquivos.arquivos,
    enviarFoto(quem, loteId, bytes, opcoes = {}) {
      const headers: Record<string, string> = { 'Content-Type': opcoes.tipo ?? 'image/jpeg' };
      if (quem) headers.Authorization = `Bearer ${quem}`;
      if (opcoes.nome) headers['X-Nome'] = encodeURIComponent(opcoes.nome);
      return app.request(`/lotes/${loteId}/fotos`, { method: 'POST', headers, body: bytes }, {});
    },
    fetch: (pedido) => app.fetch(pedido, {}),
    rotas: app.routes,
    chamar(quem, caminho, corpo) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (quem) headers.Authorization = `Bearer ${quem}`;
      return app.request(caminho, corpo === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(corpo) }, {});
    },
    async lote(campos) {
      const r = await pg.query<{ id: string }>(
        `insert into lotes (tipo, descricao, quantidade, prioridade, data_entrega, bordado, etapa, recuperacao_pendente, total_centavos)
         values ($1, $2, 20, $3, $4, $5, $6, $7, $8) returning id`,
        [
          campos.tipo ?? 'Cliente',
          campos.descricao,
          campos.prioridade ?? 'Normal',
          campos.entrega ?? '2026-11-10',
          campos.bordado ?? false,
          campos.etapa,
          campos.recuperacao ?? false,
          campos.total ?? 0,
        ],
      );
      return r.rows[0]!.id;
    },
  };
}
