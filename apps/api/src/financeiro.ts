import {
  COMPROVANTE_TAMANHO_MAXIMO,
  diaEmFortaleza,
  erroDaEntrega,
  erroDoRecebimento,
  nomeDaFoto,
  percentualPago,
  registraPagamentos,
  saldoCentavos,
  tipoDoComprovante,
  type EntregaBody,
  type FinanceiroResposta,
  type PedidoFinanceiro,
  type Perfil,
  type RecebimentoBody,
  type RecebimentoLinha,
  veValores,
} from '@pcp/shared';
import type { Armazenamento } from './armazenamento';
import type { Db, Tx } from './db';
import { CONFLITO, type Falha } from './lote';

interface PedidoLinha {
  id: string;
  numero: number;
  descricao: string;
  versao: number;
  dataEntrega: string;
  pecasEmbaladas: number | null;
  totalCentavos: number;
  recebidoCentavos: number;
}

type RecebimentoDoBanco = RecebimentoLinha & { loteId: string };

/** RF-25: o recebido no dia, nos 7 dias e no mês (horário de Fortaleza) e o total a receber. Usado aqui e no quadro da Direção. */
export async function resumoFinanceiro(db: Db, hoje: string): Promise<FinanceiroResposta['resumo']> {
  const [resumo] = await db.query<FinanceiroResposta['resumo']>(
    `select coalesce(sum(r.valor_centavos) filter (where (r.criado_em at time zone 'America/Fortaleza')::date = $1::text::date), 0)::int
              as "recebidoHojeCentavos",
            coalesce(sum(r.valor_centavos) filter (where (r.criado_em at time zone 'America/Fortaleza')::date >= $1::text::date - 6), 0)::int
              as "recebido7DiasCentavos",
            coalesce(sum(r.valor_centavos) filter (where (r.criado_em at time zone 'America/Fortaleza')::date >= date_trunc('month', $1::text::date)::date), 0)::int
              as "recebidoMesCentavos",
            (select coalesce(sum(greatest(l.total_centavos - coalesce((select sum(x.valor_centavos) from recebimentos x where x.lote_id = l.id), 0), 0)), 0)::int
               from lotes l where l.tipo = 'Cliente' and l.etapa <> 'Concluído') as "aReceberCentavos"
       from recebimentos r`,
    [hoje],
  );
  return resumo!;
}

/**
 * RF-25 e RF-26: o resumo do recebido e os pedidos de Cliente que já saíram da Embalagem, com total, recebido, saldo e
 * recebimentos. Atendimento, direção e admin: o setor nunca vê valores (RF-02).
 */
export async function listarFinanceiro(db: Db, perfil: Perfil): Promise<{ ok: true; dados: FinanceiroResposta } | Falha> {
  if (!veValores(perfil)) return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };

  const resumo = await resumoFinanceiro(db, diaEmFortaleza());

  const pedidos = await db.query<PedidoLinha>(
    `select l.id, l.numero::integer as numero, l.descricao, l.versao, l.data_entrega::text as "dataEntrega",
            l.entregue as "pecasEmbaladas", l.total_centavos as "totalCentavos",
            coalesce((select sum(r.valor_centavos) from recebimentos r where r.lote_id = l.id), 0)::int as "recebidoCentavos"
       from lotes l
      where l.tipo = 'Cliente' and l.etapa = 'Financeiro'
      order by l.data_entrega, l.numero`,
  );
  const recebimentos = await db.query<RecebimentoDoBanco>(
    `select r.id, r.lote_id as "loteId", r.valor_centavos as "valorCentavos", r.forma, r.momento, p.nome as por,
            to_char(r.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as em,
            r.comprovante_chave is not null as "temComprovante"
       from recebimentos r
       left join perfis p on p.id = r.criado_por
      where r.lote_id in (select id from lotes where tipo = 'Cliente' and etapa = 'Financeiro')
      order by r.criado_em, r.id`,
  );

  const lista: PedidoFinanceiro[] = pedidos.map((p) => ({
    ...p,
    numero: Number(p.numero),
    saldoCentavos: saldoCentavos(p.totalCentavos, p.recebidoCentavos),
    percentualPago: percentualPago(p.totalCentavos, p.recebidoCentavos),
    recebimentos: recebimentos.filter((r) => r.loteId === p.id).map(({ loteId: _, ...r }) => r),
  }));
  return { ok: true, dados: { resumo, pedidos: lista } };
}

interface LoteFinanceiro {
  id: string;
  numero: number;
  tipo: string;
  etapa: string;
  versao: number;
  total_centavos: number;
}

/** Trava o pedido e confere o que RN-29 e a versão pedem, antes de registrar recebimento ou entrega. */
async function travarNoFinanceiro(
  tx: Tx,
  loteId: string,
  versao: number,
): Promise<{ ok: true; lote: LoteFinanceiro; recebido: number } | Falha> {
  const [lote] = await tx.query<LoteFinanceiro>(
    'select id, numero, tipo, etapa, versao, total_centavos from lotes where id = $1 for update',
    [loteId],
  );
  if (!lote) return { ok: false, status: 404, erro: 'Pedido não encontrado.' };
  if (lote.etapa !== 'Financeiro' || lote.tipo !== 'Cliente') {
    return { ok: false, status: 409, erro: 'Este pedido não está no Financeiro e entrega.' };
  }
  if (lote.versao !== versao) return { ok: false, status: 409, erro: CONFLITO };
  const [{ recebido } = { recebido: 0 }] = await tx.query<{ recebido: number }>(
    'select coalesce(sum(valor_centavos), 0)::int as recebido from recebimentos where lote_id = $1',
    [lote.id],
  );
  return { ok: true, lote, recebido };
}

/**
 * RF-27, RN-25, RN-26, RN-29 e RN-32: registra um recebimento. Só com o pedido em Financeiro e entrega, dentro do saldo,
 * com forma de pagamento. Mexer no pedido sobe a versão, então um clique repetido recebe 409 em vez de lançar duas vezes.
 */
export async function registrarRecebimento(
  db: Db,
  perfil: Perfil,
  loteId: string,
  body: RecebimentoBody,
): Promise<{ ok: true; id: string; versao: number; saldoCentavos: number } | Falha> {
  if (!registraPagamentos(perfil)) return { ok: false, status: 403, erro: 'Só Atendimento, Direção e Administrador registram recebimentos.' };

  return db.transaction(async (tx) => {
    const travado = await travarNoFinanceiro(tx, loteId, body.versao);
    if (!travado.ok) return travado;
    const { lote, recebido } = travado;

    const saldo = saldoCentavos(lote.total_centavos, recebido);
    const problema = erroDoRecebimento(saldo, body.valorCentavos, body.forma);
    if (problema) return { ok: false, status: 400, erro: problema } as const;

    const [novo] = await tx.query<{ id: string }>(
      `insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por)
       values ($1, $2, $3, 'Financeiro', $4) returning id`,
      [lote.id, body.valorCentavos, body.forma, perfil.id],
    );
    const [atualizado] = await tx.query<{ versao: number }>(
      'update lotes set versao = versao + 1, atualizado_em = now() where id = $1 returning versao',
      [lote.id],
    );
    return { ok: true, id: novo!.id, versao: atualizado!.versao, saldoCentavos: saldo - body.valorCentavos } as const;
  });
}

/** RF-28 e RN-30: confirma a entrega, o que conclui o pedido. Só com saldo zero. */
export async function confirmarEntrega(
  db: Db,
  perfil: Perfil,
  loteId: string,
  body: EntregaBody,
): Promise<{ ok: true; versao: number } | Falha> {
  if (!registraPagamentos(perfil)) return { ok: false, status: 403, erro: 'Só Atendimento, Direção e Administrador confirmam a entrega.' };

  return db.transaction(async (tx) => {
    const travado = await travarNoFinanceiro(tx, loteId, body.versao);
    if (!travado.ok) return travado;
    const { lote, recebido } = travado;

    const problema = erroDaEntrega(lote.total_centavos, recebido);
    if (problema) return { ok: false, status: 400, erro: problema } as const;

    const [atualizado] = await tx.query<{ versao: number }>(
      `update lotes
          set etapa = 'Concluído', versao = versao + 1, finalizado_em = now(), atualizado_em = now()
        where id = $1 and etapa = 'Financeiro' and versao = $2
        returning versao`,
      [lote.id, lote.versao],
    );
    if (!atualizado) return { ok: false, status: 409, erro: CONFLITO } as const;

    await tx.query(
      `insert into historico (lote_id, etapa, tipo, nota, usuario_id)
       values ($1, 'Financeiro', 'Finalização', 'Entrega confirmada.', $2)`,
      [lote.id, perfil.id],
    );
    return { ok: true, versao: atualizado.versao } as const;
  });
}

/**
 * RF-27 e RN-31: guarda o comprovante de um recebimento (imagem ou PDF, até 5 MB). O tipo vem dos bytes do arquivo.
 * Um recebimento tem um comprovante só, e ele não é trocado (RN-32). Se o armazenamento falhar, nada fica gravado.
 */
export async function enviarComprovante(
  db: Db,
  arquivos: Armazenamento,
  perfil: Perfil,
  recebimentoId: string,
  dados: ArrayBuffer,
  nome: string | null | undefined,
): Promise<{ ok: true } | Falha> {
  if (!registraPagamentos(perfil)) return { ok: false, status: 403, erro: 'Só Atendimento, Direção e Administrador enviam comprovantes.' };
  if (dados.byteLength === 0) return { ok: false, status: 400, erro: 'O arquivo está vazio.' };
  if (dados.byteLength > COMPROVANTE_TAMANHO_MAXIMO) {
    return { ok: false, status: 413, erro: `O comprovante passa de ${COMPROVANTE_TAMANHO_MAXIMO / 1024 / 1024} MB.` };
  }
  const tipo = tipoDoComprovante(new Uint8Array(dados, 0, Math.min(dados.byteLength, 16)));
  if (!tipo) return { ok: false, status: 415, erro: 'Envie uma imagem (JPEG, PNG ou WebP) ou um PDF.' };

  return db.transaction(async (tx) => {
    const [rec] = await tx.query<{ id: string; loteId: string; chave: string | null }>(
      'select id, lote_id as "loteId", comprovante_chave as chave from recebimentos where id = $1 for update',
      [recebimentoId],
    );
    if (!rec) return { ok: false, status: 404, erro: 'Recebimento não encontrado.' } as const;
    if (rec.chave) return { ok: false, status: 409, erro: 'Este recebimento já tem comprovante.' } as const;

    const chave = `recebimentos/${rec.loteId}/${rec.id}`;
    await tx.query(
      `update recebimentos set comprovante_chave = $2, comprovante_tipo = $3, comprovante_tamanho = $4, comprovante_nome = $5
        where id = $1`,
      [rec.id, chave, tipo, dados.byteLength, nomeDaFoto(nome)],
    );
    await arquivos.guardar(chave, dados, tipo);
    return { ok: true } as const;
  });
}

/** Abre um comprovante. Atendimento, direção e admin; o setor nunca (RF-02). O arquivo não tem endereço público. */
export async function lerComprovante(
  db: Db,
  arquivos: Armazenamento,
  perfil: Perfil,
  recebimentoId: string,
): Promise<{ ok: true; dados: ReadableStream | ArrayBuffer; tipo: string } | Falha> {
  if (!veValores(perfil)) return { ok: false, status: 403, erro: 'Esta área não faz parte do seu perfil.' };
  const [rec] = await db.query<{ chave: string | null; tipo: string | null }>(
    'select comprovante_chave as chave, comprovante_tipo as tipo from recebimentos where id = $1',
    [recebimentoId],
  );
  if (!rec) return { ok: false, status: 404, erro: 'Recebimento não encontrado.' };
  if (!rec.chave) return { ok: false, status: 404, erro: 'Este recebimento não tem comprovante.' };
  const arquivo = await arquivos.ler(rec.chave);
  if (!arquivo) return { ok: false, status: 404, erro: 'O arquivo do comprovante não foi encontrado.' };
  return { ok: true, ...arquivo };
}
