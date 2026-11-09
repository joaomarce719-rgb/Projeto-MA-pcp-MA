import {
  CLIENTE_REMOVIDO,
  anonimizarAPartirDe,
  confirmaNome,
  cuidaDaLgpd,
  diaEmFortaleza,
  ehCnpj,
  erroDaAnonimizacao,
  removerDadosPessoais,
  type AnonimizarBody,
  type ClienteAAnonimizar,
  type PedidoDeExclusaoBody,
  type Perfil,
} from '@pcp/shared';
import type { Db, Tx } from './db';
import type { Falha } from './lote';

const SO_ADMIN: Falha = { ok: false, status: 403, erro: 'Só o Administrador cuida dos pedidos de exclusão (LGPD).' };
const NAO_ACHEI: Falha = { ok: false, status: 404, erro: 'Cliente não encontrado.' };

interface Linha {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  anonimizado: boolean;
  exclusaoPedidaEm: string | null;
  motivo: string | null;
  ultimoAno: number | null;
  emAndamento: number;
}

/** Cliente com o que a regra precisa: ano do pedido mais recente (horário de Fortaleza) e pedidos ainda não concluídos. */
const SITUACAO = `
  select c.id, c.nome, c.documento, c.telefone, c.anonimizado_em is not null as anonimizado,
         to_char(c.exclusao_pedida_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "exclusaoPedidaEm",
         c.exclusao_motivo as motivo,
         (select max(extract(year from coalesce(l.finalizado_em, l.criado_em) at time zone 'America/Fortaleza'))::int
            from lotes l where l.cliente_id = c.id) as "ultimoAno",
         (select count(*)::int from lotes l where l.cliente_id = c.id and l.etapa <> 'Concluído') as "emAndamento"
    from clientes c`;

function avaliar(l: Linha, hoje: string) {
  const liberadoEm = anonimizarAPartirDe(l.ultimoAno ? [`${l.ultimoAno}-01-01`] : [], hoje);
  const impedimento = erroDaAnonimizacao({
    documento: l.documento,
    anonimizado: l.anonimizado,
    pedidosEmAndamento: l.emAndamento,
    liberadoEm,
    hoje,
  });
  return { liberadoEm, impedimento };
}

async function carregar(tx: Tx, clienteId: string): Promise<Linha | undefined> {
  // Trava o cadastro: dois cliques ou duas pessoas não registram nem anonimizam o mesmo cliente ao mesmo tempo.
  await tx.query('select 1 from clientes where id = $1 for update', [clienteId]);
  const [linha] = await tx.query<Linha>(`${SITUACAO} where c.id = $1`, [clienteId]);
  return linha;
}

/**
 * LGPD art. 18: registra que o cliente pediu a exclusão e devolve a partir de quando os dados podem ser anonimizados
 * (o fim do prazo de guarda). Dentro do prazo, essa data é a explicação da recusa ao cliente (art. 18, §4).
 */
export async function registrarPedidoDeExclusao(
  db: Db,
  perfil: Perfil,
  clienteId: string,
  body: PedidoDeExclusaoBody,
): Promise<{ ok: true; liberadoEm: string; impedimento: string | null } | Falha> {
  if (!cuidaDaLgpd(perfil)) return SO_ADMIN;
  return db.transaction(async (tx) => {
    const linha = await carregar(tx, clienteId);
    if (!linha) return NAO_ACHEI;
    if (linha.anonimizado) return { ok: false, status: 409, erro: 'Este cliente já foi anonimizado.' } as const;
    if (ehCnpj(linha.documento)) {
      return { ok: false, status: 400, erro: 'CNPJ é de empresa: a LGPD não se aplica, e o pedido de exclusão não é registrado.' } as const;
    }
    if (linha.exclusaoPedidaEm) return { ok: false, status: 409, erro: 'O pedido de exclusão deste cliente já foi registrado.' } as const;
    await tx.query(
      'update clientes set exclusao_pedida_em = now(), exclusao_pedida_por = $2, exclusao_motivo = $3 where id = $1',
      [clienteId, perfil.id, body.motivo],
    );
    return { ok: true, ...avaliar(linha, diaEmFortaleza()) } as const;
  });
}

/** A lista "Clientes a anonimizar": pedidos de exclusão ainda não atendidos, os que já podem primeiro. */
export async function listarClientesAAnonimizar(db: Db, perfil: Perfil): Promise<{ ok: true; clientes: ClienteAAnonimizar[] } | Falha> {
  if (!cuidaDaLgpd(perfil)) return SO_ADMIN;
  const hoje = diaEmFortaleza();
  const linhas = await db.query<Linha>(`${SITUACAO} where c.exclusao_pedida_em is not null and c.anonimizado_em is null`);
  const clientes = linhas
    .map((l) => {
      const { liberadoEm, impedimento } = avaliar(l, hoje);
      return {
        id: l.id,
        nome: l.nome,
        exclusaoPedidaEm: l.exclusaoPedidaEm!,
        motivo: l.motivo ?? '',
        pedidosEmAndamento: l.emAndamento,
        liberadoEm,
        pode: impedimento === null,
        impedimento,
      };
    })
    .sort((a, b) => Number(b.pode) - Number(a.pode) || a.liberadoEm.localeCompare(b.liberadoEm) || a.nome.localeCompare(b.nome));
  return { ok: true, clientes };
}

/**
 * Anonimiza o cliente, numa transação só (ou tudo, ou nada): o cadastro vira "Cliente removido" sem documento, telefone e
 * cidade; a descrição dos pedidos dele (que copia o nome) também; nome, CPF e telefone saem das observações do pedido e do
 * histórico (`removerDadosPessoais`); fica gravado quem anonimizou e quando. Nada é apagado: pedidos, pagamentos e o
 * registro de acessos continuam. Exceção prevista na constituição (princípio III) à regra de não alterar o histórico.
 */
export async function anonimizarCliente(
  db: Db,
  perfil: Perfil,
  clienteId: string,
  body: AnonimizarBody,
): Promise<{ ok: true; observacoesTrocadas: number } | Falha> {
  if (!cuidaDaLgpd(perfil)) return SO_ADMIN;
  return db.transaction(async (tx) => {
    const linha = await carregar(tx, clienteId);
    if (!linha) return NAO_ACHEI;
    if (!linha.exclusaoPedidaEm && !linha.anonimizado) {
      return { ok: false, status: 400, erro: 'Registre antes o pedido de exclusão deste cliente.' } as const;
    }
    const { impedimento } = avaliar(linha, diaEmFortaleza());
    if (impedimento) return { ok: false, status: linha.anonimizado ? 409 : 400, erro: impedimento } as const;
    if (!confirmaNome(body.confirmacao, linha.nome)) {
      return { ok: false, status: 400, erro: 'O nome digitado não confere com o do cliente. Nada foi alterado.' } as const;
    }

    const dados = { nome: linha.nome, documento: linha.documento, telefone: linha.telefone };
    let trocadas = 0;
    const lotes = await tx.query<{ id: string; detalhes: string | null }>(
      'select id, detalhes from lotes where cliente_id = $1 for update',
      [clienteId],
    );
    for (const l of lotes) {
      const detalhes = l.detalhes === null ? null : removerDadosPessoais(l.detalhes, dados);
      if (detalhes !== l.detalhes) trocadas++;
      await tx.query('update lotes set descricao = $2, detalhes = $3, atualizado_em = now() where id = $1', [l.id, CLIENTE_REMOVIDO, detalhes]);
    }
    const notas = await tx.query<{ id: number; nota: string }>(
      `select h.id, h.nota from historico h join lotes l on l.id = h.lote_id where l.cliente_id = $1 and h.nota is not null`,
      [clienteId],
    );
    for (const h of notas) {
      const nota = removerDadosPessoais(h.nota, dados);
      if (nota === h.nota) continue;
      trocadas++;
      await tx.query('update historico set nota = $2 where id = $1', [h.id, nota]);
    }
    await tx.query(
      `update clientes set nome = $2, documento = null, telefone = null, cidade = null, anonimizado_em = now(), anonimizado_por = $3
        where id = $1`,
      [clienteId, CLIENTE_REMOVIDO, perfil.id],
    );
    return { ok: true, observacoesTrocadas: trocadas } as const;
  });
}
