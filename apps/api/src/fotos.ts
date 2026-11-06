import { FOTOS_POR_PEDIDO, abrePedidos, FOTO_TAMANHO_MAXIMO, nomeDaFoto, tipoDaImagem, type Perfil } from '@pcp/shared';
import type { Armazenamento } from './armazenamento';
import type { Db } from './db';
import type { Falha } from './lote';

/**
 * RF-11 e RF-20: guarda uma foto de referência do pedido. Só atendimento e admin enviam.
 * - O tipo vem dos bytes do arquivo (JPEG, PNG ou WebP), não do que o navegador declarou.
 * - Máximo de 2 MB por foto e 6 por pedido; o limite é conferido com o pedido travado, então dois envios ao mesmo tempo
 *   não passam de 6.
 * - A linha no banco só vale se o arquivo foi guardado: se o armazenamento falhar, a transação desfaz tudo.
 */
export async function enviarFoto(
  db: Db,
  arquivos: Armazenamento,
  perfil: Perfil,
  loteId: string,
  dados: ArrayBuffer,
  nome: string | null | undefined,
): Promise<{ ok: true; id: string } | Falha> {
  if (!abrePedidos(perfil)) {
    return { ok: false, status: 403, erro: 'Só o Atendimento envia fotos do pedido.' };
  }
  if (dados.byteLength === 0) return { ok: false, status: 400, erro: 'O arquivo está vazio.' };
  if (dados.byteLength > FOTO_TAMANHO_MAXIMO) {
    return { ok: false, status: 413, erro: `A foto passa de ${FOTO_TAMANHO_MAXIMO / 1024 / 1024} MB. Envie uma foto menor.` };
  }
  const tipo = tipoDaImagem(new Uint8Array(dados, 0, Math.min(dados.byteLength, 16)));
  if (!tipo) return { ok: false, status: 415, erro: 'Envie uma foto JPEG, PNG ou WebP.' };

  return db.transaction(async (tx) => {
    const [lote] = await tx.query<{ id: string }>('select id from lotes where id = $1 for update', [loteId]);
    if (!lote) return { ok: false, status: 404, erro: 'Pedido não encontrado.' } as const;

    const [{ total } = { total: 0 }] = await tx.query<{ total: number }>('select count(*)::int as total from fotos where lote_id = $1', [lote.id]);
    if (total >= FOTOS_POR_PEDIDO) {
      return { ok: false, status: 409, erro: `Este pedido já tem ${FOTOS_POR_PEDIDO} fotos.` } as const;
    }

    const id = crypto.randomUUID();
    const chave = `pedidos/${lote.id}/${id}`;
    await tx.query(
      `insert into fotos (id, lote_id, chave, nome, tipo, tamanho, enviado_por) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, lote.id, chave, nomeDaFoto(nome), tipo, dados.byteLength, perfil.id],
    );
    await arquivos.guardar(chave, dados, tipo);
    return { ok: true, id } as const;
  });
}

/**
 * RNF-03: abre uma foto. O setor só abre fotos de pedidos que estão no seu setor; atendimento, direção e admin abrem todas.
 */
export async function lerFoto(
  db: Db,
  arquivos: Armazenamento,
  perfil: Perfil,
  fotoId: string,
): Promise<{ ok: true; dados: ReadableStream | ArrayBuffer; tipo: string } | Falha> {
  const [foto] = await db.query<{ chave: string; etapa: string }>(
    'select f.chave, l.etapa from fotos f join lotes l on l.id = f.lote_id where f.id = $1',
    [fotoId],
  );
  if (!foto) return { ok: false, status: 404, erro: 'Foto não encontrada.' };
  if (perfil.papel === 'setor' && perfil.setor !== foto.etapa) {
    return { ok: false, status: 403, erro: 'Esta foto não é de um pedido do seu setor.' };
  }
  const arquivo = await arquivos.ler(foto.chave);
  if (!arquivo) return { ok: false, status: 404, erro: 'O arquivo da foto não foi encontrado.' };
  return { ok: true, ...arquivo };
}
