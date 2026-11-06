import { criarApp } from './app';
import { adminSupabase } from './adminAuth';
import { verificarTokenSupabase } from './auth';
import { armazenamentoR2 } from './armazenamento';
import { abrirPostgres } from './db';

export interface Env {
  HYPERDRIVE: { connectionString: string };
  /** Balde do R2 com as fotos (vínculo `ARQUIVOS` no wrangler.toml). */
  ARQUIVOS: R2Bucket;
  SUPABASE_URL: string;
  /** Segredo do Worker (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`); só a tela de usuários usa. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CORS_ORIGIN?: string;
}

export default criarApp<Env>({
  verificarToken: (token, env) => verificarTokenSupabase(token, env.SUPABASE_URL),
  abrirDb: (env) => abrirPostgres(env.HYPERDRIVE.connectionString),
  armazenamento: (env) => armazenamentoR2(env.ARQUIVOS),
  adminAuth: (env) => adminSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
});
