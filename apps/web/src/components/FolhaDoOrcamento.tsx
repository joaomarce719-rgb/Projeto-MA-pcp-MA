import { formatarReais, resumoDaGrade, tituloDoProduto, type OrcamentoDoPedido } from '@pcp/shared';
import { dataBR } from '../formatar';

/**
 * Dados da empresa que saem no orçamento. Os que ainda não foram informados ficam de fora (nada de CNPJ ou telefone
 * inventado num documento que vai para o cliente): preencha aqui quando a MA passar.
 */
const EMPRESA: { nome: string; descricao: string; cnpj?: string; telefone?: string; endereco?: string } = {
  nome: 'MA Fardamentos',
  descricao: 'Uniformes em geral · Fortaleza/CE',
};

/** RF-16: o orçamento do pedido, pronto para imprimir em A4 ou salvar como PDF. `previa` marca o que ainda não é um pedido aberto. */
export function FolhaDoOrcamento({ dados: o, previa = false }: { dados: OrcamentoDoPedido; previa?: boolean }) {
  const contatos = [EMPRESA.cnpj && `CNPJ ${EMPRESA.cnpj}`, EMPRESA.telefone && `Telefone ${EMPRESA.telefone}`, EMPRESA.endereco].filter(Boolean);
  return (
    <article className="folha" aria-label={`Orçamento número ${o.numero}`}>
      <header className="folha-cab">
        <img src="/logo-ma.png" alt={EMPRESA.nome} width={300} height={89} />
        <div className="folha-num">
          <span>ORÇAMENTO Nº</span>
          <strong>{previa ? '—' : o.numero}</strong>
          {previa && <em>Prévia: o número sai ao abrir o pedido</em>}
        </div>
      </header>
      <p className="folha-emp">
        <strong>{EMPRESA.nome} · {EMPRESA.descricao}</strong>
        {contatos.length > 0 && (
          <>
            <br />
            {contatos.join(' · ')}
          </>
        )}
      </p>

      <section className="folha-info">
        <div>
          <h3>Cliente</h3>
          <p>
            <strong>{o.cliente?.nome ?? o.descricao}</strong>
            {o.cliente?.documento && (
              <>
                <br />
                CPF/CNPJ {o.cliente.documento}
              </>
            )}
            {(o.cliente?.telefone || o.cliente?.cidade) && (
              <>
                <br />
                {[o.cliente.telefone, o.cliente.cidade].filter(Boolean).join(' · ')}
              </>
            )}
          </p>
        </div>
        <div>
          <h3>Dados</h3>
          <dl className="folha-dados">
            <dt>Data</dt>
            <dd>{dataBR(o.criadoEm)}</dd>
            <dt>Prazo de entrega</dt>
            <dd>{dataBR(o.dataEntrega)}</dd>
            <dt>Prioridade</dt>
            <dd>{o.prioridade}</dd>
            <dt>Bordado</dt>
            <dd>{o.bordado ? 'Sim' : 'Não'}</dd>
          </dl>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Grade</th>
            <th className="d">Qtd</th>
            <th className="d">Unit.</th>
            <th className="d">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {o.itens.map((i, k) => (
            <tr key={k}>
              <td>
                <strong>{tituloDoProduto(i.produto)}</strong>
                <small>
                  {i.malha ? `Malha ${tituloDoProduto(i.malha)}` : ''}
                  {i.adicionais.length > 0 && ` · + ${i.adicionais.join(', ')}`}
                </small>
              </td>
              <td>
                {resumoDaGrade(i.modo, i.grade)}
                <small>{i.modo === 'adulto' ? 'Adulto' : 'Infantil'}</small>
              </td>
              <td className="d">{i.quantidade}</td>
              <td className="d">{formatarReais(i.unitarioCentavos)}</td>
              <td className="d">
                <strong>{formatarReais(i.subtotalCentavos)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="totais">
        <tbody>
          <tr>
            <td>Peças</td>
            <td className="d">{o.pecas}</td>
          </tr>
          <tr>
            <td>Total</td>
            <td className="d">
              <strong>{formatarReais(o.totalCentavos)}</strong>
            </td>
          </tr>
          {o.recebimentos.map((r, k) => (
            <tr key={k}>
              <td>
                Recebido em {dataBR(r.dia).slice(0, 5)} · {r.forma}
              </td>
              <td className="d">− {formatarReais(r.valorCentavos)}</td>
            </tr>
          ))}
          <tr className="destaque">
            <td>Saldo a pagar</td>
            <td className="d">{formatarReais(o.saldoCentavos)}</td>
          </tr>
        </tbody>
      </table>

      <footer className="mudo">
        <strong>Válido por 30 dias.</strong> Preço por peça conforme a quantidade de cada produto. Adicionais cobrados por peça.
      </footer>
    </article>
  );
}
