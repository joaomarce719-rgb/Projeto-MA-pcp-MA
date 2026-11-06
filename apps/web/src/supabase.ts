import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !chave) {
  console.warn('Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em apps/web/.env');
}

/** O Supabase é usado só para o login. Os dados vêm da API. */
export const supabase = createClient(url ?? 'http://localhost', chave ?? 'sem-chave', {
  auth: { persistSession: true, autoRefreshToken: true },
});
