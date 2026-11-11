/**
 * Cria um Administrador (login no Supabase + perfil `admin`) pelo terminal. Serve para o primeiro Administrador e para
 * recuperar o acesso se o único Administrador perder o seu. Os demais usuários se criam pela tela de Usuários.
 *
 *   npm run criar-admin -w apps/api -- pessoa@mafardamentos.com
 *
 * Pede o nome, a senha (duas vezes, sem aparecer), a chave secreta do Supabase (`sb_secret_...`) e o endereço de
 * conexão do banco. Os dois segredos podem vir das variáveis SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL. Nada é gravado
 * em arquivo nem mostrado na tela. E-mail que já existe é recusado: o script nunca sobrescreve uma conta.
 */
import { createInterface } from 'node:readline';
import { usuarioBody } from '@pcp/shared';
import { adminSupabase } from './adminAuth';
import { abrirPostgres } from './db';
import { criarAcesso } from './usuarios';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://tddwcteekakmovczhthh.supabase.co';

// Uma interface só, lida linha a linha em fila: serve para quem digita e para respostas que chegam juntas por pipe.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const linhas = rl[Symbol.asyncIterator]();
const saida = rl as unknown as { _writeToOutput: (s: string) => void };
const escrever = saida._writeToOutput.bind(rl);
let escondendo = false;
saida._writeToOutput = (s) => {
  if (!escondendo) escrever(s); // escondendo: os caracteres digitados não aparecem
};

/** Pergunta no terminal. Com `escondido`, o que se digita não aparece (senhas e chaves). */
async function perguntar(texto: string, escondido = false): Promise<string> {
  process.stdout.write(texto);
  escondendo = escondido;
  const { value, done } = await linhas.next();
  escondendo = false;
  if (escondido) process.stdout.write('\n');
  if (done) throw new Error('A entrada terminou antes de todas as respostas.');
  return String(value).trim();
}

async function principal(): Promise<number> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    console.error('Use: npm run criar-admin -w apps/api -- pessoa@mafardamentos.com');
    return 1;
  }

  if (!process.stdin.isTTY) {
    // Ex.: Git Bash (mintty) no Windows: o próprio terminal pode mostrar o que se digita.
    console.error('Aviso: este terminal não esconde a digitação. Para digitar a senha e as chaves, use o PowerShell.');
  }
  const nome = await perguntar('Nome da pessoa: ');
  const senha = await perguntar('Senha inicial: ', true);
  if ((await perguntar('Repita a senha: ', true)) !== senha) {
    console.error('As senhas não conferem. Nada foi criado.');
    return 1;
  }

  const lido = usuarioBody.safeParse({ nome, email, senha, papel: 'admin' });
  if (!lido.success) {
    console.error(`${lido.error.issues[0]?.message ?? 'Dados inválidos.'} Nada foi criado.`);
    return 1;
  }

  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || (await perguntar('Chave secreta do Supabase (sb_secret_...): ', true));
  const banco = process.env.DATABASE_URL || (await perguntar('Endereço de conexão do banco (postgresql://...): ', true));
  if (!chave || !banco) {
    console.error('Faltou a chave secreta ou o endereço do banco. Nada foi criado.');
    return 1;
  }

  const conexao = abrirPostgres(banco);
  try {
    const r = await criarAcesso(conexao.db, adminSupabase(SUPABASE_URL, chave), lido.data);
    if (!r.ok) {
      console.error(`${r.erro} Nada foi criado.`);
      return 1;
    }
    console.log(`Administrador criado: ${lido.data.nome} (${email}). Entre no sistema e troque a senha inicial.`);
    return 0;
  } finally {
    await conexao.fechar();
  }
}

principal().then(
  (codigo) => {
    rl.close();
    process.exit(codigo);
  },
  // Só a mensagem: o erro do banco ou do Supabase pode trazer o endereço de conexão.
  (erro: unknown) => {
    console.error(`Não foi possível criar o Administrador: ${erro instanceof Error ? erro.message.split('\n')[0] : 'erro desconhecido'}`);
    process.exit(1);
  },
);
