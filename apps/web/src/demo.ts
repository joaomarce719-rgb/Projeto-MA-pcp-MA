/**
 * Modo demonstração: só existe quando a interface roda com `--mode demo` (`npm run dev:demo`), apontando para a API local
 * de exemplo (`npm run dev:local`), que aceita o id do usuário como "crachá". O build de produção não liga este modo:
 * a tela de login do site publicado continua pedindo e-mail e senha de verdade.
 */
export const MODO_DEMO = import.meta.env.VITE_MODO_DEMO === '1';

/** A senha de todos os acessos de demonstração (a mesma do protótipo). */
export const SENHA_DEMO = 'demo';

export interface AcessoDemo {
  login: string;
  nome: string;
  descricao: string;
  /** Id do usuário na API local de exemplo (ver `apps/api/src/test-support.ts` e `dev-local.ts`). */
  id: string;
  /** Número do setor na rota de produção, para a lista. */
  numero?: string;
}

const id = (final: string) => `00000000-0000-0000-0000-0000000000${final}`;

export const ACESSOS_DEMO: AcessoDemo[] = [
  { login: 'atendimento', nome: 'Atendimento', descricao: 'Abre pedidos, cobra e entrega', id: id('a1') },
  { login: 'precos', nome: 'Atendimento (preços)', descricao: 'Atendimento com permissão de gerenciar preços', id: id('c1') },
  { login: 'direcao', nome: 'Direção', descricao: 'Vê tudo; cuida de preços e do financeiro', id: id('a4') },
  { login: 'admin', nome: 'Administrador', descricao: 'Vê o processo todo e gerencia usuários', id: id('a5') },
  { login: 'design', nome: 'Design', descricao: 'usuário design', id: id('a8'), numero: '01' },
  { login: 'impressao', nome: 'Impressão', descricao: 'usuário impressao', id: id('a2'), numero: '02' },
  { login: 'batida', nome: 'Batida', descricao: 'usuário batida', id: id('b1'), numero: '03' },
  { login: 'laser', nome: 'Laser', descricao: 'usuário laser', id: id('a7'), numero: '04' },
  { login: 'conferencia', nome: 'Conferência', descricao: 'usuário conferencia', id: id('b2'), numero: '05' },
  { login: 'bordado', nome: 'Bordado', descricao: 'usuário bordado', id: id('b3'), numero: '06' },
  { login: 'costura', nome: 'Costura', descricao: 'usuário costura', id: id('a3'), numero: '07' },
  { login: 'embalagem', nome: 'Embalagem', descricao: 'usuário embalagem', id: id('b4'), numero: '08' },
];

/** Onde o supabase-js guarda a sessão: `sb-<primeira parte do endereço>-auth-token`. */
function chaveDaSessao(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'http://localhost';
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

/** Acha o acesso pelo login digitado e a senha de demonstração, ou devolve null. */
export function acessoDoLogin(login: string, senha: string): AcessoDemo | null {
  if (senha !== SENHA_DEMO) return null;
  return ACESSOS_DEMO.find((a) => a.login === login.trim().toLowerCase()) ?? null;
}

/** Entra como o acesso escolhido: grava uma sessão de mentira, que só a API local de exemplo aceita, e abre o sistema. */
export function entrarComoDemo(acesso: AcessoDemo): void {
  const agora = Math.floor(Date.now() / 1000);
  localStorage.setItem(
    chaveDaSessao(),
    JSON.stringify({
      access_token: acesso.id,
      refresh_token: 'demo',
      token_type: 'bearer',
      expires_in: 86_400,
      expires_at: agora + 86_400,
      user: { id: acesso.id, aud: 'authenticated', role: 'authenticated', email: `${acesso.login}@demo.local`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }),
  );
  window.location.assign('/fila');
}

/** Sair do modo demonstração: não há servidor de login para avisar, então só se apaga a sessão guardada. */
export function sairDoDemo(): void {
  localStorage.removeItem(chaveDaSessao());
}
