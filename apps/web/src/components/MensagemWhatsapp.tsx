import { mensagemDoOrcamento, type OrcamentoDoPedido } from '@pcp/shared';
import { useRef, useState } from 'react';
import { Janela } from './Janela';

/** RF-17: a mensagem do orçamento, pronta para copiar. O sistema não envia nada pelo WhatsApp. */
export function MensagemWhatsapp({ dados, aoFechar }: { dados: OrcamentoDoPedido; aoFechar: () => void }) {
  const texto = useRef<HTMLTextAreaElement>(null);
  const [aviso, setAviso] = useState('');
  const mensagem = mensagemDoOrcamento(dados);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem);
      setAviso('Mensagem copiada.');
    } catch {
      // Sem permissão para a área de transferência (ou sem HTTPS): seleciona o texto para a pessoa copiar.
      texto.current?.focus();
      texto.current?.select();
      setAviso('Selecione o texto e copie (Ctrl+C).');
    }
  }

  return (
    <Janela titulo="Enviar no WhatsApp" aoFechar={aoFechar}>
      <h2>Enviar no WhatsApp</h2>
      <p className="mudo">A mensagem fica pronta para copiar. O sistema não envia nada.</p>
      <label className="sr-only" htmlFor="wpp-msg">
        Mensagem pronta
      </label>
      <textarea id="wpp-msg" ref={texto} className="wpp" readOnly rows={12} value={mensagem} />
      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}
      <div className="acoes">
        <button className="sec" onClick={aoFechar}>
          Fechar
        </button>
        <button className="pri" onClick={copiar}>
          Copiar mensagem
        </button>
      </div>
    </Janela>
  );
}
