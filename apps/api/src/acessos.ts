import type { Tx } from './db';

/** As telas que entregam CPF/CNPJ e telefone de cliente completos (a busca sai mascarada e não entra). */
export type TelaDeAcesso = 'ficha' | 'orcamento';

/**
 * RNF-02 (LGPD): grava quem recebeu os dados pessoais de quais clientes, por qual tela e quando (uma linha por cliente).
 * Chame antes de devolver os dados: se a gravação falhar, a rota dá erro e o dado não sai sem registro.
 * O banco só aceita inclusões nesta tabela (migração 004).
 */
export async function registrarAcesso(
  db: Tx,
  perfilId: string,
  tela: TelaDeAcesso,
  clienteIds: string[],
  loteId: string | null = null,
): Promise<void> {
  if (clienteIds.length === 0) return;
  // Lista como texto JSON convertido no SQL: com o postgres.js real, `$n::jsonb` seria codificado duas vezes (CLAUDE.md).
  await db.query(
    `insert into acessos_dados_pessoais (perfil_id, cliente_id, tela, lote_id)
     select $1, x::uuid, $3, $4 from jsonb_array_elements_text(($2::text)::jsonb) as x`,
    [perfilId, JSON.stringify(clienteIds), tela, loteId],
  );
}
