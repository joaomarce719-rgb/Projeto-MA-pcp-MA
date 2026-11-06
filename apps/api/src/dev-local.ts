/**
 * Servidor local para ver e testar o sistema SEM Supabase nem Cloudflare.
 * Roda a API de verdade (mesmas rotas e regras) sobre um Postgres em memória com dados de exemplo.
 * O "login" aceita o id do usuário de teste como token. NÃO é uma forma de entrar em produção:
 * este arquivo não vai para a Cloudflare (o wrangler publica só `src/index.ts`).
 *
 * Uso: npm run dev:local -w apps/api   (porta 8787, a que a interface espera)
 */
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { diaEmFortaleza, somarDias } from '@pcp/shared';
import { ID, criarAmbiente } from './test-support';

const PORTA = Number(process.env.PORT ?? 8787);
const amb = await criarAmbiente();
const hoje = diaEmFortaleza();

async function ok<T>(r: Response | Promise<Response>): Promise<T> {
  const resposta = await r;
  if (!resposta.ok) throw new Error(`Falha ao montar os dados de exemplo: ${resposta.status} ${await resposta.text()}`);
  return resposta.json() as Promise<T>;
}

async function cliente(nome: string, documento: string, cidade: string) {
  return (await ok<{ cliente: { id: string } }>(amb.chamar(ID.atendimento, '/clientes', { nome, documento, telefone: '(85) 90000-0000', cidade }))).cliente.id;
}

async function pedido(clienteId: string, descricaoDaFeira: string | null, dias: number, prioridade: string, itens: object[], extra: object = {}) {
  return ok<{ id: string; numero: number; totalCentavos: number }>(
    amb.chamar(ID.atendimento, '/pedidos', {
      tipo: descricaoDaFeira ? 'Feira' : 'Cliente',
      ...(descricaoDaFeira ? { descricao: descricaoDaFeira } : { clienteId }),
      prioridade,
      dataEntrega: somarDias(hoje, dias),
      itens,
      ...extra,
    }),
  );
}

/** O admin pode concluir qualquer etapa; serve para levar o pedido de exemplo até onde se quer. */
async function levarAte(id: string, alvo: string) {
  // Lê a etapa real a cada passo: sem bordado, a Conferência pula direto para a Costura.
  for (let tentativas = 0; tentativas < 10; tentativas++) {
    const { etapa, versao } = (await amb.pg.query<{ etapa: string; versao: number }>('select etapa, versao from lotes where id = $1', [id])).rows[0]!;
    if (etapa === alvo) return;
    await ok(amb.chamar(ID.admin, `/lotes/${id}/concluir`, { versao, maquina: '03', pecas: 20 }));
  }
  throw new Error(`O pedido não chegou em ${alvo}.`);
}

/** Uma imagem PNG de verdade (degradê) para as fotos de exemplo, sem depender de arquivos. */
function pngDegrade(largura: number, altura: number, [r, g, b]: [number, number, number]): Uint8Array {
  const linha = largura * 3 + 1;
  const bruto = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const k = y * linha + 1 + x * 3;
      const luz = 0.45 + 0.55 * (x / largura) * (1 - (0.5 * y) / altura);
      bruto[k] = Math.round(r * luz);
      bruto[k + 1] = Math.round(g * luz);
      bruto[k + 2] = Math.round(b * luz);
    }
  }
  const bloco = (tipo: string, dados: Buffer) => {
    const miolo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc32(miolo));
    return Buffer.concat([tamanho, miolo, soma]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', cabecalho), bloco('IDAT', deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]),
  );
}

async function foto(pedidoId: string, nome: string, cor: [number, number, number]) {
  const r = await amb.enviarFoto(ID.atendimento, pedidoId, pngDegrade(240, 180, cor), { tipo: 'image/png', nome });
  if (!r.ok) throw new Error(`Falha ao montar as fotos de exemplo: ${r.status} ${await r.text()}`);
}

// Os setores que faltam no cenário de testes (Batida, Conferência, Bordado e Embalagem), para a tela de acessos de demonstração
// poder entrar em qualquer um dos 8 setores. Os ids precisam ser os de apps/web/src/demo.ts.
for (const [final, nome, setor] of [
  ['b1', 'Batida', 'Batida'],
  ['b2', 'Conferência', 'Conferência'],
  ['b3', 'Bordado', 'Bordado'],
  ['b4', 'Embalagem', 'Embalagem'],
] as const) {
  const id = `00000000-0000-0000-0000-0000000000${final}`;
  const login = setor.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  await amb.pg.query('insert into auth.users (id) values ($1)', [id]);
  await amb.pg.query("insert into perfis (id, nome, email, papel, setor) values ($1, $2, $3, 'setor', $4)", [id, nome, `${login}@demo.local`, setor]);
}

// Uma segunda pessoa do Atendimento, já com a permissão de gerenciar preços (o atendimento comum não tem). Id de apps/web/src/demo.ts.
{
  const id = '00000000-0000-0000-0000-0000000000c1';
  await amb.pg.query('insert into auth.users (id) values ($1)', [id]);
  await amb.pg.query("insert into perfis (id, nome, email, papel, gerencia_precos) values ($1, 'Atendimento (preços)', 'precos@demo.local', 'atendimento', true)", [id]);
}

const clube = await cliente('Clube Atlético Exemplo', '00.000.000/0001-00', 'Fortaleza/CE');
const escola = await cliente('Escola Modelo Aurora', '00.000.000/0002-00', 'Caucaia/CE');
await cliente('Academia Demo Fit', '00.000.000/0004-00', 'Eusébio/CE');

const camisa = { produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { P: 4, M: 10, G: 8, GG: 2 } };
const infantil = { produto: 'Camisa infantil malha dry fit plus', modo: 'infantil', grade: { '6': 6, '8': 8, '10': 10, '12': 8 } };

const aDesign = await pedido(clube, null, 9, 'Normal', [camisa]);
const emImpressao = await pedido(escola, null, 2, 'Urgente', [infantil, { ...camisa, produto: 'Calção adulto malha dry fit', grade: { M: 6, G: 6 } }], { bordado: true, punho: 'Punho ribana' });
await levarAte(emImpressao.id, 'Impressão');
const noLaser = await pedido(clube, null, 3, 'Alta', [{ ...camisa, adicionais: { patch: true } }], { bordado: true });
await levarAte(noLaser.id, 'Laser');
const naEmbalagem = await pedido(clube, 'Feira do Centro · camisas dry fit', 7, 'Normal', [camisa]);
await levarAte(naEmbalagem.id, 'Embalagem');
const devolvido = await pedido(escola, null, 3, 'Alta', [infantil], { detalhes: 'Número nas costas, de 1 a 20.' });
await levarAte(devolvido.id, 'Laser');
{
  const { versao } = (await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [devolvido.id])).rows[0]!;
  await ok(amb.chamar(ID.laser, `/lotes/${devolvido.id}/devolver`, { versao, motivo: '3 peças tamanho 8 com falha na sublimação da manga.' }));
}

// Um pedido esperando em cada setor que ainda estava sem fila, para testar a tela de qualquer setor.
const naBatida = await pedido(escola, null, 5, 'Normal', [camisa]);
await levarAte(naBatida.id, 'Batida');
const naConferencia = await pedido(clube, null, 4, 'Alta', [infantil]);
await levarAte(naConferencia.id, 'Conferência');
const noBordado = await pedido(escola, null, 6, 'Normal', [{ ...camisa, adicionais: { patch: true } }], { bordado: true, detalhes: 'Patch do patrocinador no peito.' });
await levarAte(noBordado.id, 'Bordado');
const naCostura = await pedido(clube, null, 3, 'Urgente', [camisa, { ...camisa, produto: 'Calção adulto malha dry fit' }], { punho: 'Punho ribana' });
await levarAte(naCostura.id, 'Costura');

// Um pedido já concluído (para a aba "Concluídos") e um atrasado (a data de entrega não pode ser passada ao abrir
// o pedido, então o atraso é montado direto no banco).
const concluido = await pedido(clube, 'Feira da Praia · camisas lisas', 5, 'Normal', [camisa]);
await levarAte(concluido.id, 'Embalagem');
{
  const { versao } = (await amb.pg.query<{ versao: number }>('select versao from lotes where id = $1', [concluido.id])).rows[0]!;
  await ok(amb.chamar(ID.admin, `/lotes/${concluido.id}/concluir`, { versao, pecas: 24 }));
}
await amb.pg.query('update lotes set data_entrega = $2 where id = $1', [aDesign.id, somarDias(hoje, -2)]);

// Dois pedidos de Cliente no Financeiro: um com entrada de metade (falta cobrar o saldo) e um quitado (pronto para a entrega).
// O total vem do catálogo; a entrada é gravada direto no banco para não depender do valor de cada produto.
async function comEntrada(id: string, total: number, fracao: number, forma: string) {
  await amb.pg.query(
    `insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por) values ($1, $2, $3, 'Entrada', $4)`,
    [id, Math.round(total * fracao), forma, ID.atendimento],
  );
}
const aCobrar = await pedido(clube, null, 4, 'Normal', [camisa]);
await comEntrada(aCobrar.id, aCobrar.totalCentavos, 0.5, 'Pix');
await levarAte(aCobrar.id, 'Financeiro');
const quitado = await pedido(escola, null, 6, 'Normal', [infantil]);
await comEntrada(quitado.id, quitado.totalCentavos, 1, 'Dinheiro');
await levarAte(quitado.id, 'Financeiro');

await foto(emImpressao.id, 'frente.png', [30, 90, 200]);
await foto(emImpressao.id, 'costas.png', [200, 60, 60]);
await foto(noLaser.id, 'patch.png', [40, 150, 90]);

const servidor = createServer(async (req, res) => {
  try {
    const partes: Buffer[] = [];
    for await (const parte of req) partes.push(parte as Buffer);
    const semCorpo = req.method === 'GET' || req.method === 'HEAD';
    const resposta = await amb.fetch(
      new Request(`http://localhost:${PORTA}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(semCorpo ? {} : { body: Buffer.concat(partes) }),
      }),
    );
    res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
    res.end(Buffer.from(await resposta.arrayBuffer()));
  } catch (erro) {
    console.error(erro);
    res.writeHead(500).end();
  }
});

servidor.listen(PORTA, () => {
  console.log(`API local em http://localhost:${PORTA} (banco em memória; os dados somem ao parar)`);
  console.log(`Pedidos de exemplo: #${aDesign.numero} Design · #${emImpressao.numero} Impressão · #${noLaser.numero} Laser · #${naEmbalagem.numero} Embalagem · #${devolvido.numero} devolvido ao Design · #${aCobrar.numero} no Financeiro (falta cobrar) · #${quitado.numero} no Financeiro (quitado)`);
  console.log('');
  console.log('Para entrar na interface sem Supabase, abra http://localhost:5173 e rode no console do navegador');
  console.log("(troque USUARIO por: atendimento, impressao, laser, design, costura, direcao ou admin):");
  console.log('');
  const ids = JSON.stringify(ID);
  console.log(`  const ids = ${ids}; const u = 'USUARIO';`);
  console.log("  localStorage.setItem('sb-localhost-auth-token', JSON.stringify({access_token: ids[u], refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: {id: ids[u], aud: 'authenticated', role: 'authenticated', email: u+'@local', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'}})); location.href = '/fila';");
  console.log('');
  console.log('Isso só funciona sem apps/web/.env (a interface precisa apontar para http://localhost).');
  console.log('');
  console.log('Mais fácil: rode a interface em modo demonstração (npm run dev:demo -w apps/web) e abra http://localhost:5173,');
  console.log('que tem a tela de acessos de demonstração (um toque para entrar como Atendimento, Direção, Administrador ou cada setor).');
});
