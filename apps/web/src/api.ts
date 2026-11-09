import type {
  ClienteAAnonimizar,
  ClienteBody,
  ClienteLinha,
  ConcluirBody,
  DevolverBody,
  EntregaBody,
  FichaLote,
  FinanceiroResposta,
  LoteFila,
  OrcamentoDoPedido,
  PedidoBody,
  Perfil,
  ProdutoBody,
  ProdutoDePreco,
  ProdutoDoCatalogo,
  QuadroResposta,
  RecebimentoBody,
  UsuarioBody,
  UsuarioLinha,
} from '@pcp/shared';
import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

export class ErroApi extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Faz a chamada com o crachá (token) do login; se a API recusar, vira um ErroApi com a mensagem para a pessoa. */
async function pedir(caminho: string, init: { metodo?: string; headers?: Record<string, string>; corpo?: BodyInit } = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: init.metodo ?? 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    ...(init.corpo === undefined ? {} : { body: init.corpo }),
  });
  if (!resposta.ok) {
    const json = (await resposta.json().catch(() => ({}))) as { erro?: string };
    throw new ErroApi(resposta.status, json.erro ?? 'Não foi possível concluir a ação.');
  }
  return resposta;
}

async function chamar<T>(caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await pedir(caminho, {
    ...(corpo === undefined ? {} : { metodo: 'POST', corpo: JSON.stringify(corpo) }),
    headers: { 'Content-Type': 'application/json' },
  });
  return (await resposta.json().catch(() => ({}))) as T;
}

export const api = {
  eu: () => chamar<Perfil>('/me'),
  fila: (aba: 'andamento' | 'concluidos' = 'andamento') => chamar<{ lotes: LoteFila[] }>(`/fila?aba=${aba}`),
  ficha: (id: string) => chamar<FichaLote>(`/lotes/${id}`),
  concluir: (id: string, corpo: ConcluirBody) =>
    chamar<{ etapa: string; versao: number }>(`/lotes/${id}/concluir`, corpo),
  devolver: (id: string, corpo: DevolverBody) =>
    chamar<{ etapa: string; versao: number }>(`/lotes/${id}/devolver`, corpo),
  clientes: (q: string) => chamar<{ clientes: ClienteLinha[] }>(`/clientes?q=${encodeURIComponent(q)}`),
  criarCliente: (corpo: ClienteBody) => chamar<{ cliente: ClienteLinha }>('/clientes', corpo),
  criarPedido: (corpo: PedidoBody) => chamar<{ id: string; numero: number; entradaId: string | null; totalCentavos: number }>('/pedidos', corpo),
  financeiro: () => chamar<FinanceiroResposta>('/financeiro'),
  quadro: () => chamar<QuadroResposta>('/quadro'),
  catalogo: () => chamar<{ produtos: ProdutoDoCatalogo[] }>('/catalogo'),
  precos: () => chamar<{ produtos: ProdutoDePreco[] }>('/precos'),
  criarProduto: (corpo: ProdutoBody) => chamar<{ id: string }>('/precos', corpo),
  atualizarProduto: (id: string, corpo: ProdutoBody) => chamar<{ ok: true }>(`/precos/${id}`, corpo),
  orcamento: (pedidoId: string) => chamar<OrcamentoDoPedido>(`/lotes/${pedidoId}/orcamento`),
  registrarRecebimento: (pedidoId: string, corpo: RecebimentoBody) =>
    chamar<{ id: string; versao: number; saldoCentavos: number }>(`/lotes/${pedidoId}/recebimentos`, corpo),
  entregar: (pedidoId: string, corpo: EntregaBody) => chamar<{ etapa: string; versao: number }>(`/lotes/${pedidoId}/entregar`, corpo),
  /** Comprovante (imagem ou PDF) de um recebimento. Como a foto, sai da API com a permissão conferida. */
  comprovante: async (recebimentoId: string): Promise<Blob> => (await pedir(`/recebimentos/${recebimentoId}/comprovante`)).blob(),
  enviarComprovante: async (recebimentoId: string, arquivo: Blob, nome: string): Promise<void> => {
    await pedir(`/recebimentos/${recebimentoId}/comprovante`, {
      metodo: 'POST',
      headers: { 'Content-Type': arquivo.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(nome) },
      corpo: arquivo,
    });
  },
  usuarios: () => chamar<{ usuarios: UsuarioLinha[] }>('/usuarios'),
  criarUsuario: (corpo: UsuarioBody) => chamar<{ id: string }>('/usuarios', corpo),
  mudarAtivo: (id: string, ativo: boolean) => chamar<{ ok: true }>(`/usuarios/${id}/ativo`, { ativo }),
  mudarGerenciaPrecos: (id: string, gerenciaPrecos: boolean) => chamar<{ ok: true }>(`/usuarios/${id}/precos`, { gerenciaPrecos }),
  trocarSenha: (id: string, senha: string) => chamar<{ ok: true }>(`/usuarios/${id}/senha`, { senha }),
  lgpdExclusoes: () => chamar<{ clientes: ClienteAAnonimizar[] }>('/lgpd/exclusoes'),
  pedirExclusao: (clienteId: string, motivo: string) =>
    chamar<{ liberadoEm: string; impedimento: string | null }>(`/clientes/${clienteId}/exclusao`, { motivo }),
  anonimizar: (clienteId: string, confirmacao: string) =>
    chamar<{ observacoesTrocadas: number }>(`/clientes/${clienteId}/anonimizar`, { confirmacao }),
  /** A foto sai da API (com a permissão conferida), então vem como arquivo, não como endereço público. */
  foto: async (id: string): Promise<Blob> => (await pedir(`/fotos/${id}`)).blob(),
  enviarFoto: async (pedidoId: string, imagem: Blob, nome: string): Promise<{ id: string }> => {
    const resposta = await pedir(`/lotes/${pedidoId}/fotos`, {
      metodo: 'POST',
      headers: { 'Content-Type': imagem.type, 'X-Nome': encodeURIComponent(nome) },
      corpo: imagem,
    });
    return (await resposta.json()) as { id: string };
  },
};
