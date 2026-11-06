import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { veValores } from '@pcp/shared';
import { ErroApi, api } from '../api';
import { FolhaDoOrcamento } from '../components/FolhaDoOrcamento';
import { MensagemWhatsapp } from '../components/MensagemWhatsapp';
import { useEu } from '../eu';

/** RF-15 a RF-17: orçamento do pedido de Cliente, para imprimir (A4 ou PDF) e para enviar pelo WhatsApp. É do Atendimento. */
export function Orcamento() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) {
    return (
      <p className="erro" role="alert">
        {eu.error instanceof ErroApi ? eu.error.message : 'Não foi possível carregar seu perfil.'}
      </p>
    );
  }
  // O orçamento mostra valores e dados do cliente: Atendimento, Direção e Administrador. A API também recusa o setor.
  if (!veValores(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. O orçamento é do Atendimento.</div>;
  }
  return <Pagina />;
}

function Pagina() {
  const { pedidoId } = useParams({ from: '/area/orcamento/$pedidoId' });
  const orcamento = useQuery({ queryKey: ['orcamento', pedidoId], queryFn: () => api.orcamento(pedidoId) });
  const [whatsapp, setWhatsapp] = useState(false);

  if (orcamento.isError) {
    return (
      <>
        <p className="erro" role="alert">
          {orcamento.error instanceof ErroApi ? orcamento.error.message : 'Não foi possível abrir o orçamento.'}
        </p>
        <Link to="/fila" className="botao sec">
          Voltar aos pedidos
        </Link>
      </>
    );
  }
  if (!orcamento.isSuccess) return <p className="mudo">Carregando…</p>;

  return (
    <>
      <div className="barra no-print">
        <Link to="/fila" className="botao sec">
          Voltar
        </Link>
        <div className="acoes-do-cartao">
          <button className="sec" onClick={() => window.print()}>
            Imprimir / Salvar PDF
          </button>
          <button className="pri" onClick={() => setWhatsapp(true)}>
            Enviar no WhatsApp
          </button>
        </div>
      </div>
      <FolhaDoOrcamento dados={orcamento.data} />
      {whatsapp && <MensagemWhatsapp dados={orcamento.data} aoFechar={() => setWhatsapp(false)} />}
    </>
  );
}
