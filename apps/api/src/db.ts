import postgres from 'postgres';

export type Row = Record<string, unknown>;

export interface Tx {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface Conexao {
  db: Db;
  fechar(): Promise<void>;
}

/** `unsafe` desliga os prepared statements por padrão; a Cloudflare recomenda mantê-los ligados com o Hyperdrive. */
const PREPARADO = { prepare: true } as const;

/**
 * Cliente Postgres criado a cada requisição (nos Workers uma conexão não sobrevive entre elas).
 * Segue o exemplo da Cloudflare para postgres.js + Hyperdrive: máximo de 5 conexões por requisição,
 * sem consulta de tipos e com prepared statements ligados.
 */
export function abrirPostgres(connectionString: string): Conexao {
  const sql = postgres(connectionString, { max: 5, fetch_types: false });

  const db: Db = {
    query: <T>(text: string, params: unknown[] = []) =>
      sql.unsafe(text, params as never[], PREPARADO) as unknown as Promise<T[]>,
    transaction: (fn) =>
      sql.begin(async (t) =>
        fn({
          query: <T>(text: string, params: unknown[] = []) =>
            t.unsafe(text, params as never[], PREPARADO) as unknown as Promise<T[]>,
        }),
      ) as never,
  };

  return { db, fechar: () => sql.end({ timeout: 1 }) };
}

/** O banco recusou um valor repetido numa coluna única (código 23505 do Postgres): duas pessoas gravando o mesmo ao mesmo tempo. */
export const ehRepetido = (erro: unknown): boolean => (erro as { code?: string } | null)?.code === '23505';
