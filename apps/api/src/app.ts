import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import {
  FOTO_TAMANHO_MAXIMO,
  ativoBody,
  clienteBody,
  concluirBody,
  devolverBody,
  COMPROVANTE_TAMANHO_MAXIMO,
  entregaBody,
  anonimizarBody,
  gerenciaPrecosBody,
  pedidoBody,
  pedidoDeExclusaoBody,
  produtoBody,
  recebimentoBody,
  senhaBody,
  usuarioBody,
  type Perfil,
} from '@pcp/shared';
import type { ZodType } from 'zod';
import type { AdminAuth } from './adminAuth';
import type { Armazenamento } from './armazenamento';
import { listarCatalogo } from './catalogo';
import { buscarClientes, criarCliente } from './clientes';
import { anonimizarCliente, listarClientesAAnonimizar, registrarPedidoDeExclusao } from './lgpd';
import { concluirLote } from './concluir';
import type { Conexao, Db } from './db';
import { devolverLote } from './devolver';
import { confirmarEntrega, enviarComprovante, lerComprovante, listarFinanceiro, registrarRecebimento } from './financeiro';
import { enviarFoto, lerFoto } from './fotos';
import { obterFicha } from './ficha';
import { listarFila } from './fila';
import { criarPedido } from './pedidos';
import { atualizarProduto, criarProduto, listarPrecos } from './precos';
import { obterOrcamento } from './orcamento';
import { obterQuadro } from './quadro';
import { criarUsuario, listarUsuarios, mudarAtivo, mudarGerenciaPrecos, trocarSenha } from './usuarios';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Deps<E extends object> {
  /** Confere o crachá (JWT) e devolve o id do usuário. Lança erro se for inválido ou expirado. */
  verificarToken(token: string, env: E): Promise<string>;
  abrirDb(env: E): Conexao | Promise<Conexao>;
  /** Onde ficam as fotos (R2 em produção). */
  armazenamento(env: E): Armazenamento;
  /** Criar usuários e trocar senhas no Supabase Auth (precisa da chave service_role, só no servidor). */
  adminAuth(env: E): AdminAuth;
}

interface Variaveis {
  db: Db;
  perfil: Perfil;
}

type Ambiente<E extends object> = { Bindings: E; Variables: Variaveis };

interface PerfilLinha {
  id: string;
  nome: string;
  papel: Perfil['papel'];
  setor: string | null;
  gerenciaPrecos: boolean;
}

function aposResposta<E extends object>(c: Context<Ambiente<E>>, tarefa: Promise<unknown>): Promise<unknown> | void {
  try {
    c.executionCtx.waitUntil(tarefa);
  } catch {
    return tarefa; // sem ExecutionContext (testes): espera aqui mesmo
  }
}

/** Lê o corpo até `limite` bytes e para de ler assim que passar (null): não depende do tamanho que o navegador declara. */
async function lerAteOLimite(corpo: ReadableStream<Uint8Array> | null, limite: number): Promise<ArrayBuffer | null> {
  if (!corpo) return new ArrayBuffer(0);
  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.byteLength;
  }
  return tudo.buffer;
}

/** Tempo gasto no banco, em ms, no formato do cabeçalho Server-Timing (usado pelo script de medição). */
function tempoDeBanco(inicio: number): string {
  return `db;dur=${(performance.now() - inicio).toFixed(1)}`;
}

export function criarApp<E extends object & { CORS_ORIGIN?: string }>(deps: Deps<E>) {
  const app = new Hono<Ambiente<E>>();

  app.use(
    '*',
    cors({
      origin: (origem, c) => {
        const env = c.env as { CORS_ORIGIN?: string };
        const permitidas = (env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
        return permitidas.includes(origem) ? origem : null;
      },
      allowHeaders: ['Authorization', 'Content-Type', 'X-Nome'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      exposeHeaders: ['Server-Timing'],
      maxAge: 600,
    }),
  );

  app.onError((erro, c) => {
    console.error(erro);
    return c.json({ erro: 'Algo deu errado. Tente de novo em instantes.' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  /** Confere o crachá e carrega o perfil (papel e setor) da tabela `perfis`, nunca do token. */
  const autenticar = createMiddleware<Ambiente<E>>(async (c, next) => {
    const cabecalho = c.req.header('Authorization') ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!token) return c.json({ erro: 'Entre com seu usuário e senha.' }, 401);

    let userId: string;
    try {
      userId = await deps.verificarToken(token, c.env);
    } catch {
      return c.json({ erro: 'Sessão inválida ou expirada.' }, 401);
    }

    const conexao = await deps.abrirDb(c.env);
    try {
      const [linha] = await conexao.db.query<PerfilLinha>(
        'select id, nome, papel, setor, gerencia_precos as "gerenciaPrecos" from perfis where id = $1 and ativo',
        [userId],
      );
      if (!linha) return c.json({ erro: 'Usuário sem perfil ativo.' }, 403);
      c.set('db', conexao.db);
      c.set('perfil', linha);
      await next();
    } finally {
      await aposResposta(c, conexao.fechar());
    }
  });

  /** Toda rota exige login, menos /health: rota nova já nasce protegida. */
  app.use('*', async (c, next) => (c.req.path === '/health' ? next() : autenticar(c, next)));

  /** Lê e valida o corpo JSON. Em caso de erro, `resposta` já é o 400 pronto, com a primeira mensagem em `erro`. */
  async function lerCorpo<T>(c: Context<Ambiente<E>>, esquema: ZodType<T>) {
    const lido = esquema.safeParse(await c.req.json().catch(() => null));
    if (lido.success) return { dados: lido.data };
    const detalhes = lido.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
    return { resposta: c.json({ erro: detalhes[0]?.mensagem ?? 'Dados inválidos.', detalhes }, 400) };
  }

  /**
   * Lê o arquivo enviado no corpo, sem passar de `limite` bytes: recusa já pelo tamanho declarado e, se ele faltar ou
   * mentir, para de ler assim que passar. Em caso de erro, `resposta` já é o 413 pronto. O nome vem em X-Nome (URL).
   */
  async function lerArquivo(c: Context<Ambiente<E>>, limite: number, muitoGrande: string) {
    const declarado = Number(c.req.header('Content-Length') ?? '');
    const dados = Number.isFinite(declarado) && declarado > limite ? null : await lerAteOLimite(c.req.raw.body, limite);
    if (!dados) return { resposta: c.json({ erro: muitoGrande }, 413) };
    let nome: string | null = null;
    try {
      nome = decodeURIComponent(c.req.header('X-Nome') ?? '');
    } catch {
      nome = null;
    }
    return { dados, nome };
  }

  app.get('/me', (c) => c.json(c.var.perfil));

  /** RF-06 e RF-18: fila em andamento (padrão) ou, para quem não é de setor, os concluídos (`?aba=concluidos`). */
  app.get('/fila', async (c) => {
    const aba = c.req.query('aba') ?? 'andamento';
    if (aba !== 'andamento' && aba !== 'concluidos') return c.json({ erro: 'Aba inválida.' }, 400);

    const inicio = performance.now();
    const r = await listarFila(c.var.db, c.var.perfil, aba);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ lotes: r.lotes });
  });

  /** RF-09: busca de clientes por nome, documento ou cidade (atendimento, direção e admin). */
  app.get('/clientes', async (c) => {
    const r = await buscarClientes(c.var.db, c.var.perfil, c.req.query('q') ?? '');
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ clientes: r.clientes });
  });

  app.post('/clientes', async (c) => {
    const corpo = await lerCorpo(c, clienteBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await criarCliente(c.var.db, c.var.perfil, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ cliente: r.cliente }, 201);
  });

  /** LGPD art. 18 (só o Administrador): registra o pedido de exclusão e diz a partir de quando o cliente pode ser anonimizado. */
  app.post('/clientes/:id/exclusao', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Cliente inválido.' }, 400);
    const corpo = await lerCorpo(c, pedidoDeExclusaoBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await registrarPedidoDeExclusao(c.var.db, c.var.perfil, id, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ liberadoEm: r.liberadoEm, impedimento: r.impedimento }, 201);
  });

  /** A lista "Clientes a anonimizar" (só o Administrador). */
  app.get('/lgpd/exclusoes', async (c) => {
    const r = await listarClientesAAnonimizar(c.var.db, c.var.perfil);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ clientes: r.clientes });
  });

  /** Anonimiza o cliente depois do prazo de guarda (só o Administrador, confirmando com o nome do cliente). */
  app.post('/clientes/:id/anonimizar', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Cliente inválido.' }, 400);
    const corpo = await lerCorpo(c, anonimizarBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await anonimizarCliente(c.var.db, c.var.perfil, id, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ observacoesTrocadas: r.observacoesTrocadas });
  });

  /** RF-14: abre o pedido e o envia para o Design. */
  app.post('/pedidos', async (c) => {
    const corpo = await lerCorpo(c, pedidoBody);
    if (corpo.resposta) return corpo.resposta;
    const inicio = performance.now();
    const r = await criarPedido(c.var.db, c.var.perfil, corpo.dados);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ id: r.id, numero: r.numero, entradaId: r.entradaId, totalCentavos: r.totalCentavos }, 201);
  });

  /** RF-10: catálogo de produtos e preços (`veValores`: o setor nunca vê valores). */
  app.get('/catalogo', async (c) => {
    const r = await listarCatalogo(c.var.db, c.var.perfil);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ produtos: r.produtos });
  });

  /** RF-15 a RF-17: orçamento do pedido de Cliente (`veValores` e `veDadosPessoais`). */
  app.get('/lotes/:id/orcamento', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);
    const r = await obterOrcamento(c.var.db, c.var.perfil, id);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json(r.orcamento);
  });

  /** RF-29 a RF-32: quadro da Direção (só leitura; direção e admin). */
  app.get('/quadro', async (c) => {
    const inicio = performance.now();
    const r = await obterQuadro(c.var.db, c.var.perfil);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json(r.quadro);
  });

  /** RF-25 e RF-26: recebido no dia, 7 dias e mês, total a receber e pedidos no Financeiro (`veValores`). */
  app.get('/financeiro', async (c) => {
    const inicio = performance.now();
    const r = await listarFinanceiro(c.var.db, c.var.perfil);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json(r.dados);
  });

  /** RF-27: registra um recebimento do pedido (com valor e forma; o comprovante sobe em seguida). */
  app.post('/lotes/:id/recebimentos', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);
    const corpo = await lerCorpo(c, recebimentoBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await registrarRecebimento(c.var.db, c.var.perfil, id, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ id: r.id, versao: r.versao, saldoCentavos: r.saldoCentavos }, 201);
  });

  /** RF-28: confirma a entrega e conclui o pedido (só com saldo zero). */
  app.post('/lotes/:id/entregar', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);
    const corpo = await lerCorpo(c, entregaBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await confirmarEntrega(c.var.db, c.var.perfil, id, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ etapa: 'Concluído', versao: r.versao });
  });

  /** RF-27: envia o comprovante de um recebimento (o corpo é o arquivo; o nome vai em X-Nome, codificado como URL). */
  app.post('/recebimentos/:id/comprovante', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Recebimento inválido.' }, 400);
    const arquivo = await lerArquivo(c, COMPROVANTE_TAMANHO_MAXIMO, `O comprovante passa de ${COMPROVANTE_TAMANHO_MAXIMO / 1024 / 1024} MB.`);
    if (arquivo.resposta) return arquivo.resposta;
    const r = await enviarComprovante(c.var.db, deps.armazenamento(c.env), c.var.perfil, id, arquivo.dados, arquivo.nome);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ ok: true }, 201);
  });

  app.get('/recebimentos/:id/comprovante', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Recebimento inválido.' }, 400);
    const r = await lerComprovante(c.var.db, deps.armazenamento(c.env), c.var.perfil, id);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.body(r.dados as ReadableStream, 200, {
      'Content-Type': r.tipo,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
  });

  /** RF-08, RF-20, RF-33: ficha do pedido. O setor só abre os do seu setor e não recebe dados do cliente. */
  app.get('/lotes/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);
    const r = await obterFicha(c.var.db, c.var.perfil, id);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json(r.ficha);
  });

  /**
   * RF-11: envia uma foto de referência (o corpo é a imagem; o nome vai no cabeçalho X-Nome, codificado como URL).
   * Só atendimento e admin. O tipo vem dos bytes do arquivo.
   */
  app.post('/lotes/:id/fotos', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);
    const arquivo = await lerArquivo(c, FOTO_TAMANHO_MAXIMO, `A foto passa de ${FOTO_TAMANHO_MAXIMO / 1024 / 1024} MB. Envie uma foto menor.`);
    if (arquivo.resposta) return arquivo.resposta;
    const r = await enviarFoto(c.var.db, deps.armazenamento(c.env), c.var.perfil, id, arquivo.dados, arquivo.nome);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ id: r.id }, 201);
  });

  /** RNF-03: abre uma foto, depois de conferir a permissão. O arquivo nunca tem endereço público. */
  app.get('/fotos/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Foto inválida.' }, 400);
    const r = await lerFoto(c.var.db, deps.armazenamento(c.env), c.var.perfil, id);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.body(r.dados as ReadableStream, 200, {
      'Content-Type': r.tipo,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
  });

  /** RN-11: produtos e preços (`podeGerenciarPrecos`). A escrita é por POST, como no resto da API. */
  app.get('/precos', async (c) => {
    const r = await listarPrecos(c.var.db, c.var.perfil);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ produtos: r.produtos });
  });

  app.post('/precos', async (c) => {
    const corpo = await lerCorpo(c, produtoBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await criarProduto(c.var.db, c.var.perfil, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ id: r.id }, 201);
  });

  app.post('/precos/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Produto inválido.' }, 400);
    const corpo = await lerCorpo(c, produtoBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await atualizarProduto(c.var.db, c.var.perfil, id, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ ok: true });
  });

  /** RF-04: usuários (só o Administrador). */
  app.get('/usuarios', async (c) => {
    const r = await listarUsuarios(c.var.db, c.var.perfil);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ usuarios: r.usuarios });
  });

  app.post('/usuarios', async (c) => {
    const corpo = await lerCorpo(c, usuarioBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await criarUsuario(c.var.db, deps.adminAuth(c.env), c.var.perfil, corpo.dados);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ id: r.id }, 201);
  });

  app.post('/usuarios/:id/ativo', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Usuário inválido.' }, 400);
    const corpo = await lerCorpo(c, ativoBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await mudarAtivo(c.var.db, c.var.perfil, id, corpo.dados.ativo);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ ok: true });
  });

  app.post('/usuarios/:id/precos', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Usuário inválido.' }, 400);
    const corpo = await lerCorpo(c, gerenciaPrecosBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await mudarGerenciaPrecos(c.var.db, c.var.perfil, id, corpo.dados.gerenciaPrecos);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ ok: true });
  });

  app.post('/usuarios/:id/senha', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Usuário inválido.' }, 400);
    const corpo = await lerCorpo(c, senhaBody);
    if (corpo.resposta) return corpo.resposta;
    const r = await trocarSenha(c.var.db, deps.adminAuth(c.env), c.var.perfil, id, corpo.dados.senha);
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ ok: true });
  });

  app.post('/lotes/:id/concluir', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);

    const corpo = await lerCorpo(c, concluirBody);
    if (corpo.resposta) return corpo.resposta;

    const inicio = performance.now();
    const r = await concluirLote(c.var.db, c.var.perfil, id, corpo.dados);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ etapa: r.etapa, versao: r.versao });
  });

  /** RF-23 e RN-23: Laser e Conferência devolvem o pedido ao Design, com motivo. */
  app.post('/lotes/:id/devolver', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Pedido inválido.' }, 400);

    const corpo = await lerCorpo(c, devolverBody);
    if (corpo.resposta) return corpo.resposta;

    const inicio = performance.now();
    const r = await devolverLote(c.var.db, c.var.perfil, id, corpo.dados);
    c.header('Server-Timing', tempoDeBanco(inicio));
    if (!r.ok) return c.json({ erro: r.erro }, r.status);
    return c.json({ etapa: 'Design', versao: r.versao });
  });

  return app;
}
