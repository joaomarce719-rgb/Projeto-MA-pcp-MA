import {
  Link,
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { abrePedidos, cuidaDaLgpd, gerenciaUsuarios, paginaInicial, podeGerenciarPrecos, veQuadro, veValores } from '@pcp/shared';
import { MODO_DEMO, sairDoDemo } from './demo';
import { useEu } from './eu';
import { Fila } from './pages/Fila';
import { Financeiro } from './pages/Financeiro';
import { Lgpd } from './pages/Lgpd';
import { Login } from './pages/Login';
import { NovoPedido } from './pages/NovoPedido';
import { Orcamento } from './pages/Orcamento';
import { Precos } from './pages/Precos';
import { Quadro } from './pages/Quadro';
import { Usuarios } from './pages/Usuarios';
import { supabase } from './supabase';

/**
 * Cada perfil vê só o seu caminho: setor, a fila do setor; atendimento, os pedidos, o financeiro e o orçamento;
 * direção, pedidos, financeiro, preços e o quadro. As regras são as de `permissoes.ts`, as mesmas da API.
 */
function Layout() {
  const navegar = useNavigate();
  const cache = useQueryClient();
  const p = useEu().data;
  async function sair() {
    if (MODO_DEMO) {
      // Recarrega a página: o login de demonstração não tem servidor, e assim nada da sessão anterior fica na memória.
      sairDoDemo();
      window.location.assign('/login');
      return;
    }
    await supabase.auth.signOut();
    cache.clear();
    await navegar({ to: '/login' });
  }
  return (
    <>
      <header className="topo no-print">
        <strong className="marca">MA · PCP</strong>
        <nav>
          <Link to="/fila">{p && veValores(p) ? 'Pedidos' : 'Minha fila'}</Link>
          {p && veQuadro(p) && <Link to="/quadro">Quadro</Link>}
          {p && abrePedidos(p) && <Link to="/novo">Novo pedido</Link>}
          {p && veValores(p) && <Link to="/financeiro">Financeiro</Link>}
          {p && podeGerenciarPrecos(p) && <Link to="/precos">Preços</Link>}
          {p && gerenciaUsuarios(p) && <Link to="/usuarios">Usuários</Link>}
          {p && cuidaDaLgpd(p) && <Link to="/lgpd">LGPD</Link>}
        </nav>
        <button className="sec" onClick={sair}>
          Sair
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

const raiz = createRootRoute({ component: Outlet });

async function exigirLogin() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: '/login' });
}

/** Quem já entrou e abre /login vai direto para a sua primeira tela. */
async function pularLoginSeJaEntrou() {
  const { data } = await supabase.auth.getSession();
  if (data.session) throw redirect({ to: '/' });
}

/** Primeira tela de cada perfil (`paginaInicial`, em `permissoes.ts`). */
function PaginaInicial() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  return <Navigate to={eu.data ? paginaInicial(eu.data) : '/fila'} replace />;
}

const login = createRoute({ getParentRoute: () => raiz, path: '/login', component: Login, beforeLoad: pularLoginSeJaEntrou });
const area = createRoute({ getParentRoute: () => raiz, id: 'area', component: Layout, beforeLoad: exigirLogin });
const fila = createRoute({ getParentRoute: () => area, path: '/fila', component: Fila });
const quadro = createRoute({ getParentRoute: () => area, path: '/quadro', component: Quadro });
const financeiro = createRoute({ getParentRoute: () => area, path: '/financeiro', component: Financeiro });
const orcamento = createRoute({ getParentRoute: () => area, path: '/orcamento/$pedidoId', component: Orcamento });
const novo = createRoute({ getParentRoute: () => area, path: '/novo', component: NovoPedido });
const precos = createRoute({ getParentRoute: () => area, path: '/precos', component: Precos });
const usuarios = createRoute({ getParentRoute: () => area, path: '/usuarios', component: Usuarios });
const lgpd = createRoute({ getParentRoute: () => area, path: '/lgpd', component: Lgpd });
const inicio = createRoute({ getParentRoute: () => area, path: '/', component: PaginaInicial });

const arvore = raiz.addChildren([login, area.addChildren([inicio, fila, quadro, novo, financeiro, orcamento, precos, usuarios, lgpd])]);

export const router = createRouter({ routeTree: arvore });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
