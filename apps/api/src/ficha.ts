import {
  veDadosPessoais,
  veValores,
  malhaDoCalcao,
  percentualPago,
  saldoCentavos,
  type EventoHistorico,
  type FichaLote,
  type FotoFicha,
  type ItemFicha,
  type Perfil,
  type RecebimentoLinha,
} from '@pcp/shared';
import type { Db } from './db';
import type { Falha } from './lote';

interface LoteCompleto {
  id: string;
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  quantidade: number;
  prioridade: FichaLote['prioridade'];
  dataEntrega: string;
  bordado: boolean;
  punho: string;
  detalhes: string | null;
  etapa: string;
  versao: number;
  recuperacaoPendente: boolean;
  clienteId: string | null;
  cNome: string | null;
  cDocumento: string | null;
  cTelefone: string | null;
  cCidade: string | null;
  totalCentavos: number;
}

/**
 * RF-08, RF-20 e RF-33: ficha do pedido, com produtos, especificações e linha do tempo (quem fez, quando, o que informou).
 * O setor só abre pedidos que estão no seu setor e nunca recebe os dados pessoais do cliente (RNF-02).
 */
export async function obterFicha(db: Db, perfil: Perfil, loteId: string): Promise<{ ok: true; ficha: FichaLote } | Falha> {
  const [l] = await db.query<LoteCompleto>(
    `select l.id, l.numero, l.tipo, l.descricao, l.quantidade, l.prioridade,
            l.data_entrega::text as "dataEntrega", l.bordado, l.punho, l.detalhes, l.etapa, l.versao,
            l.recuperacao_pendente as "recuperacaoPendente", l.cliente_id as "clienteId",
            c.nome as "cNome", c.documento as "cDocumento", c.telefone as "cTelefone", c.cidade as "cCidade",
            l.total_centavos as "totalCentavos"
       from lotes l
       left join clientes c on c.id = l.cliente_id
      where l.id = $1`,
    [loteId],
  );
  if (!l) return { ok: false, status: 404, erro: 'Pedido não encontrado.' };

  const ehSetor = perfil.papel === 'setor';
  if (ehSetor && perfil.setor !== l.etapa) {
    return { ok: false, status: 403, erro: 'Este pedido não está no seu setor.' };
  }

  const itens = await db.query<ItemFicha>(
    `select produto, malha, modo, grade, quantidade, adicionais from itens_pedido where lote_id = $1 order by ordem`,
    [l.id],
  );
  const fotos = await db.query<FotoFicha>('select id, nome from fotos where lote_id = $1 order by criado_em, id', [l.id]);
  const historico = await db.query<EventoHistorico>(
    `select h.etapa, h.tipo, h.nota, h.maquina, h.pecas, p.nome as por,
            to_char(h.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as em
       from historico h
       left join perfis p on p.id = h.usuario_id
      where h.lote_id = $1
      order by h.id`,
    [l.id],
  );

  const ficha: FichaLote = {
    id: l.id,
    numero: Number(l.numero),
    tipo: l.tipo,
    descricao: l.descricao,
    quantidade: l.quantidade,
    prioridade: l.prioridade,
    dataEntrega: l.dataEntrega,
    bordado: l.bordado,
    punho: l.punho,
    detalhes: l.detalhes,
    etapa: l.etapa,
    versao: l.versao,
    recuperacaoPendente: l.recuperacaoPendente,
    itens,
    malhaCalcao: malhaDoCalcao(itens),
    fotos,
    historico,
  };
  if (veDadosPessoais(perfil) && l.clienteId && l.cNome) {
    ficha.cliente = { id: l.clienteId, nome: l.cNome, documento: l.cDocumento, telefone: l.cTelefone, cidade: l.cCidade };
  }
  // Valores e recebimentos: só pedido de Cliente, e nunca para o setor (RF-02).
  if (veValores(perfil) && l.tipo === 'Cliente') {
    const recebimentos = await db.query<RecebimentoLinha>(
      `select r.id, r.valor_centavos as "valorCentavos", r.forma, r.momento, p.nome as por,
              to_char(r.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as em,
              r.comprovante_chave is not null as "temComprovante"
         from recebimentos r
         left join perfis p on p.id = r.criado_por
        where r.lote_id = $1
        order by r.criado_em, r.id`,
      [l.id],
    );
    const recebido = recebimentos.reduce((soma, r) => soma + r.valorCentavos, 0);
    ficha.valores = {
      totalCentavos: l.totalCentavos,
      recebidoCentavos: recebido,
      saldoCentavos: saldoCentavos(l.totalCentavos, recebido),
      percentualPago: percentualPago(l.totalCentavos, recebido),
      recebimentos,
    };
  }
  return { ok: true, ficha };
}
