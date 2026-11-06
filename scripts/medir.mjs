// Mede o tempo da API de ponta a ponta. Uso: veja "Medir" no README.
// Precisa de um usuário com perfil "admin" (ele pode concluir qualquer etapa) e dos lotes de db/seed-medicao.sql.

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Falta a variável ${nome}. Veja o README.`);
    process.exit(1);
  }
  return valor;
}

/** Endereço sem a barra final, para montar caminhos como `${API_URL}/fila`. */
const endereco = (nome) => exigir(nome).replace(/\/$/, '');

const SUPABASE_URL = endereco('SUPABASE_URL');
const SUPABASE_ANON_KEY = exigir('SUPABASE_ANON_KEY');
const API_URL = endereco('API_URL');
const EMAIL = exigir('MEDIR_EMAIL');
const SENHA = exigir('MEDIR_SENHA');
const N_FILA = Number(process.env.N_FILA ?? 20);

async function entrar() {
  const t0 = performance.now();
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });
  if (!r.ok) throw new Error(`Login falhou (${r.status}). Confira e-mail, senha e SUPABASE_ANON_KEY.`);
  const { access_token } = await r.json();
  return { token: access_token, ms: performance.now() - t0 };
}

async function chamar(token, caminho, corpo) {
  const t0 = performance.now();
  const r = await fetch(`${API_URL}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const total = performance.now() - t0;
  const json = await r.json().catch(() => ({}));
  const db = Number(/db;dur=([\d.]+)/.exec(r.headers.get('server-timing') ?? '')?.[1] ?? NaN);
  return { status: r.status, total, db, json };
}

function resumo(nome, amostras) {
  const v = amostras.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return `${nome.padEnd(34)} sem amostras`;
  const pct = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const f = (x) => `${x.toFixed(0)} ms`.padStart(8);
  return `${nome.padEnd(34)} n=${String(v.length).padStart(3)}  mín ${f(v[0])}  mediana ${f(pct(0.5))}  p95 ${f(pct(0.95))}  máx ${f(v.at(-1))}`;
}

const login = await entrar();
console.log(`Login no Supabase: ${login.ms.toFixed(0)} ms\n`);
const { token } = login;

// 1) Leitura da fila (a primeira chamada acorda o Worker e abre a conexão: fica fora da conta)
const quente = await chamar(token, '/fila');
if (quente.status !== 200) throw new Error(`/fila respondeu ${quente.status}: ${JSON.stringify(quente.json)}`);
console.log(`Primeira chamada (fria, descartada): ${quente.total.toFixed(0)} ms\n`);

const filaTotal = [];
const filaDb = [];
for (let i = 0; i < N_FILA; i++) {
  const r = await chamar(token, '/fila');
  filaTotal.push(r.total);
  filaDb.push(r.db);
}

// 2) Concluir etapa: leva cada lote de MEDIÇÃO até o Financeiro (precisa de usuário admin)
const { lotes } = (await chamar(token, '/fila')).json;
const alvo = lotes.filter((l) => l.descricao.startsWith('MEDIÇÃO '));
if (!alvo.length) {
  console.error('Nenhum lote "MEDIÇÃO" na fila. Rode db/seed-medicao.sql no Supabase e use um usuário admin.');
  process.exit(1);
}

const concTotal = [];
const concDb = [];
const falhas = [];
for (const lote of alvo) {
  let { etapa, versao } = lote;
  while (etapa !== 'Financeiro' && etapa !== 'Concluído') {
    // maquina e pecas são ignoradas pelas etapas que não as exigem
    const r = await chamar(token, `/lotes/${lote.id}/concluir`, { versao, maquina: '02', pecas: lote.quantidade });
    if (r.status !== 200) {
      falhas.push(`${lote.descricao} em ${etapa}: ${r.status} ${JSON.stringify(r.json)}`);
      break;
    }
    concTotal.push(r.total);
    concDb.push(r.db);
    etapa = r.json.etapa;
    versao = r.json.versao;
  }
}

console.log('Resultados (tempo visto por quem chama, de ponta a ponta):');
console.log(resumo('GET /fila · total', filaTotal));
console.log(resumo('GET /fila · só o banco', filaDb));
console.log(resumo('POST concluir etapa · total', concTotal));
console.log(resumo('POST concluir etapa · só o banco', concDb));
const sobra = (t, d) => t.map((x, i) => x - d[i]);
console.log(resumo('concluir · rede + Worker (total − banco)', sobra(concTotal, concDb)));
if (falhas.length) console.log(`\nFalhas (${falhas.length}):\n  ${falhas.join('\n  ')}`);
console.log('\nO tempo de "só o banco" é medido dentro do Worker; a diferença para o total é a distância até a Cloudflare.');
