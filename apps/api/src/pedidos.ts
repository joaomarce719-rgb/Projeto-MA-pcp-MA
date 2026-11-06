import {
  VALOR_MAXIMO_CENTAVOS,
  abrePedidos,
  erroDaDataDeEntrega,
  erroDoRecebimento,
  formatarReais,
  modoDoProduto,
  precificarItem,
  quantidadeDaGrade,
  tituloDoProduto,
  type Perfil,
  type PedidoBody,
} from '@pcp/shared';
import type { Db } from './db';
import type { Falha } from './lote';

export type ResultadoPedido = { ok: true; id: string; numero: number; entradaId: string | null; totalCentavos: number } | Falha;

interface ProdutoDoCatalogo {
  nome: string;
  malha: string;
  maior: number;
  menor: number;
}

/**
 * RF-09 a RF-14: abre o pedido, grava a entrada (se houve) e o envia para o Design.
 * - Cada produto tem de estar no catálogo (sem diferenciar maiúsculas); o preço é o do catálogo no dia, copiado para o
 *   item, e o total é calculado aqui (RN-07 a RN-10). Nada de preço ou total vem da tela.
 * - Lote, produtos e histórico entram na mesma transação: ou o pedido existe inteiro, ou não existe.
 * - A quantidade do pedido é a soma das grades, calculada aqui; ninguém digita.
 * - Pedido de Feira não é cobrado: os preços ficam em zero.
 */
export async function criarPedido(db: Db, perfil: Perfil, body: PedidoBody): Promise<ResultadoPedido> {
  if (!abrePedidos(perfil)) {
    return { ok: false, status: 403, erro: 'Só o Atendimento abre pedidos.' };
  }
  const erroData = erroDaDataDeEntrega(body.dataEntrega);
  if (erroData) return { ok: false, status: 400, erro: erroData };

  return db.transaction(async (tx): Promise<ResultadoPedido> => {
    const catalogo = new Map(
      (
        await tx.query<ProdutoDoCatalogo>(
          `select nome, malha, preco_maior_centavos as maior, preco_menor_centavos as menor from produtos where ativo`,
        )
      ).map((p) => [p.nome.toUpperCase(), p]),
    );

    const itens = [];
    for (const [i, item] of body.itens.entries()) {
      const produto = catalogo.get(item.produto.trim().toUpperCase());
      if (!produto) {
        return { ok: false, status: 400, erro: `"${item.produto}" não está no catálogo. Escolha um produto da lista.` };
      }
      const modo = modoDoProduto(produto.nome);
      if (item.modo !== modo) {
        return { ok: false, status: 400, erro: `${tituloDoProduto(produto.nome)} usa a grade ${modo}.` };
      }
      const quantidade = quantidadeDaGrade(item.modo, item.grade);
      const preco =
        body.tipo === 'Cliente'
          ? precificarItem({ quantidade, maiorCentavos: produto.maior, menorCentavos: produto.menor, adicionais: item.adicionais })
          : { precoUnitarioCentavos: 0, adicionaisUnitarioCentavos: 0, subtotalCentavos: 0 };
      itens.push({
        ordem: i + 1,
        produto: produto.nome,
        malha: produto.malha,
        modo: item.modo,
        grade: Object.fromEntries(Object.entries(item.grade).filter(([, q]) => q > 0)),
        quantidade,
        adicionais: item.adicionais,
        preco_unitario_centavos: preco.precoUnitarioCentavos,
        adicionais_unitario_centavos: preco.adicionaisUnitarioCentavos,
        subtotal_centavos: preco.subtotalCentavos,
      });
    }
    const quantidade = itens.reduce((soma, i) => soma + i.quantidade, 0);
    const total = itens.reduce((soma, i) => soma + i.subtotal_centavos, 0);
    if (total > VALOR_MAXIMO_CENTAVOS) {
      return { ok: false, status: 400, erro: `O total passa de ${formatarReais(VALOR_MAXIMO_CENTAVOS)}. Confira as quantidades.` };
    }

    // RN-25: a entrada não passa do total calculado.
    if (body.entrada) {
      const problema =
        total <= 0
          ? 'Este pedido não tem valor cadastrado; não há entrada a registrar.'
          : erroDoRecebimento(total, body.entrada.valorCentavos, body.entrada.forma);
      if (problema) return { ok: false, status: 400, erro: problema };
    }

    let descricao = body.descricao ?? '';
    let clienteId: string | null = null;
    if (body.tipo === 'Cliente') {
      const [cliente] = await tx.query<{ id: string; nome: string }>('select id, nome from clientes where id = $1', [
        body.clienteId,
      ]);
      if (!cliente) return { ok: false, status: 400, erro: 'Cliente não encontrado. Escolha um cliente salvo ou cadastre um novo.' };
      clienteId = cliente.id;
      descricao = cliente.nome;
    }

    const [lote] = await tx.query<{ id: string; numero: number }>(
      `insert into lotes (tipo, descricao, cliente_id, quantidade, prioridade, data_entrega, bordado, punho, detalhes, total_centavos)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, numero`,
      [
        body.tipo,
        descricao,
        clienteId,
        quantidade,
        body.prioridade,
        body.dataEntrega,
        body.bordado,
        body.punho,
        body.detalhes || null,
        total,
      ],
    );
    if (!lote) throw new Error('O pedido não foi criado.');

    // O parâmetro é declarado como texto e convertido no SQL: com `$2::jsonb` o postgres.js (Hyperdrive real) codifica o
    // texto uma segunda vez e o banco recebe uma string, não uma lista ("cannot call jsonb_to_recordset on a non-array").
    // O Postgres em memória dos testes não repete esse comportamento.
    await tx.query(
      `insert into itens_pedido (lote_id, ordem, produto, malha, modo, grade, quantidade, adicionais,
                                 preco_unitario_centavos, adicionais_unitario_centavos, subtotal_centavos)
       select $1, x.ordem, x.produto, x.malha, x.modo, x.grade, x.quantidade, x.adicionais,
              x.preco_unitario_centavos, x.adicionais_unitario_centavos, x.subtotal_centavos
         from jsonb_to_recordset(($2::text)::jsonb)
              as x(ordem int, produto text, malha text, modo text, grade jsonb, quantidade int, adicionais jsonb,
                   preco_unitario_centavos int, adicionais_unitario_centavos int, subtotal_centavos int)`,
      [lote.id, JSON.stringify(itens)],
    );

    await tx.query(
      `insert into historico (lote_id, etapa, tipo, nota, usuario_id)
       values ($1, 'Atendimento', 'Cadastro', 'Pedido aberto.', $2)`,
      [lote.id, perfil.id],
    );

    // RF-14 e RN-24: a entrada, se houve, é gravada junto com o pedido (o comprovante sobe depois, pela API de comprovantes).
    let entradaId: string | null = null;
    if (body.entrada) {
      const [entrada] = await tx.query<{ id: string }>(
        `insert into recebimentos (lote_id, valor_centavos, forma, momento, criado_por)
         values ($1, $2, $3, 'Entrada', $4) returning id`,
        [lote.id, body.entrada.valorCentavos, body.entrada.forma, perfil.id],
      );
      entradaId = entrada?.id ?? null;
    }

    return { ok: true, id: lote.id, numero: Number(lote.numero), entradaId, totalCentavos: total };
  });
}
