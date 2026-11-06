import { createRemoteJWKSet, jwtVerify } from 'jose';

const chaves = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Confere o crachá (JWT) emitido pelo Supabase Auth com as chaves públicas do projeto
 * e devolve o id do usuário. O crachá só diz QUEM é a pessoa; papel e setor vêm da tabela `perfis`.
 */
export async function verificarTokenSupabase(token: string, supabaseUrl: string): Promise<string> {
  const base = supabaseUrl.replace(/\/$/, '');
  let jwks = chaves.get(base);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    chaves.set(base, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${base}/auth/v1`,
    audience: 'authenticated',
  });
  if (!payload.sub) throw new Error('Token sem usuário');
  return payload.sub;
}
