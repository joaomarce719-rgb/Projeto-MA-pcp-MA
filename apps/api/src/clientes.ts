import { abrePedidos, veDadosPessoais, type ClienteBody, type ClienteLinha, type Perfil } from '@pcp/shared';
import { ehRepetido, type Db } from './db';
import type { Falha } from './lote';

const SEM_PERMISSAO: Falha = { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };

/** RF-09: busca por nome, documento ou cidade. Sem texto, devolve os primeiros por ordem alfabética. */
export async function buscarClientes(
  db: Db,
  perfil: Perfil,
  texto: string,
): Promise<{ ok: true; clientes: ClienteLinha[] } | Falha> {
  if (!veDadosPessoais(perfil)) return SEM_PERMISSAO; // RNF-02 (LGPD)
  // % e _ são curingas do LIKE; quem digita "50%" procura o texto, não "qualquer coisa".
  const termo = texto.trim().replace(/[\\%_]/g, '\\$&');
  const clientes = await db.query<ClienteLinha>(
    `select id, nome, documento, telefone, cidade
       from clientes
      where $1 = '' or lower(nome || ' ' || coalesce(documento, '') || ' ' || coalesce(cidade, '')) like '%' || lower($1) || '%' escape '\\'
      order by nome
      limit 20`,
    [termo],
  );
  return { ok: true, clientes };
}

/** RF-09: cadastra o cliente uma vez. Um documento (CPF/CNPJ) identifica um só cliente. */
export async function criarCliente(
  db: Db,
  perfil: Perfil,
  body: ClienteBody,
): Promise<{ ok: true; cliente: ClienteLinha } | Falha> {
  if (!abrePedidos(perfil)) {
    return { ok: false, status: 403, erro: 'Só o Atendimento cadastra clientes.' };
  }
  const documento = body.documento || null;
  if (documento) {
    const [igual] = await db.query<{ nome: string }>('select nome from clientes where documento = $1', [documento]);
    if (igual) return { ok: false, status: 409, erro: `Já existe um cliente com este documento: ${igual.nome}.` };
  }
  let cliente: ClienteLinha | undefined;
  try {
    [cliente] = await db.query<ClienteLinha>(
      `insert into clientes (nome, documento, telefone, cidade, criado_por)
       values ($1, $2, $3, $4, $5)
       returning id, nome, documento, telefone, cidade`,
      [body.nome, documento, body.telefone || null, body.cidade || null, perfil.id],
    );
  } catch (erro) {
    // Duas pessoas cadastrando o mesmo documento ao mesmo tempo: as duas passaram pela conferência acima.
    if (ehRepetido(erro)) return { ok: false, status: 409, erro: 'Já existe um cliente com este documento.' };
    throw erro;
  }
  if (!cliente) throw new Error('O cliente não foi criado.');
  return { ok: true, cliente };
}
