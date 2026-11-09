import { confirmaNome, cuidaDaLgpd, type ClienteAAnonimizar, type ClienteLinha } from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErroApi, api } from '../api';
import { Janela } from '../components/Janela';
import { useEu } from '../eu';
import { dataBR, quando } from '../formatar';

const mensagemDe = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao);

/**
 * LGPD art. 18 (só o Administrador): registra o pedido de exclusão de um cliente e mostra a partir de quando ele pode
 * ser anonimizado (o fim do prazo de guarda). Quando chega a data, a lista libera o botão "Anonimizar".
 */
export function Lgpd() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) return <p className="erro" role="alert">{mensagemDe(eu.error, 'Não foi possível carregar seu perfil.')}</p>;
  if (!cuidaDaLgpd(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. Só o Administrador cuida dos pedidos de exclusão.</div>;
  }
  return (
    <>
      <h1>Pedidos de exclusão (LGPD)</h1>
      <p className="mudo">
        Os dados de uma venda ficam guardados por obrigação legal até o fim do prazo de guarda. Registre o pedido do cliente:
        o sistema mostra a data a partir da qual ele pode ser anonimizado. Essa data é a resposta a dar ao cliente.
      </p>
      <RegistrarPedido />
      <ClientesAAnonimizar />
    </>
  );
}

function RegistrarPedido() {
  const cache = useQueryClient();
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteLinha | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [resposta, setResposta] = useState<{ nome: string; liberadoEm: string; impedimento: string | null } | null>(null);

  const clientes = useQuery({ queryKey: ['clientes', termo], queryFn: () => api.clientes(termo ?? ''), enabled: termo !== null });

  const registrar = useMutation({
    mutationFn: () => api.pedirExclusao(cliente!.id, motivo),
    onSuccess: (r) => {
      setResposta({ nome: cliente!.nome, ...r });
      setCliente(null);
      setMotivo('');
      void cache.invalidateQueries({ queryKey: ['lgpd'] });
    },
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível registrar o pedido.')),
  });

  function buscar(e: FormEvent) {
    e.preventDefault();
    setResposta(null);
    setTermo(busca.trim());
  }

  return (
    <section className="cartao">
      <h2>Registrar pedido de exclusão</h2>
      <form onSubmit={buscar}>
        <label htmlFor="lgpd-busca">Cliente (nome, documento ou cidade)</label>
        <input id="lgpd-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
        <div className="acoes">
          <button className="sec">Buscar</button>
        </div>
      </form>
      {termo !== null && (
        <div className="clientes">
          {clientes.isPending && <p className="mudo">Buscando…</p>}
          {clientes.isError && <p className="erro">Não foi possível buscar os clientes.</p>}
          {clientes.data?.clientes.length === 0 && <p className="mudo">Nenhum cliente encontrado.</p>}
          {clientes.data?.clientes.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`cliente${cliente?.id === c.id ? ' marcado' : ''}`}
              aria-pressed={cliente?.id === c.id}
              onClick={() => { setCliente(c); setErro(''); }}
            >
              <strong>{c.nome}</strong>
              <span className="mudo">{[c.cidade, c.documento].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
      {cliente && (
        <>
          <label htmlFor="lgpd-motivo">Como o pedido chegou (quem pediu, canal e data)</label>
          <textarea id="lgpd-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pediu por e-mail em 09/11/2026" />
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes">
            <button
              className="pri"
              disabled={registrar.isPending}
              onClick={() => {
                if (motivo.trim().length < 3) return setErro('Descreva o pedido (quem pediu, por qual canal, quando).');
                setErro('');
                registrar.mutate();
              }}
            >
              {registrar.isPending ? 'Registrando…' : `Registrar pedido de ${cliente.nome}`}
            </button>
          </div>
        </>
      )}
      {resposta && (
        <div role="status">
          <p>
            <strong>Pedido de {resposta.nome} registrado.</strong>{' '}
            {resposta.impedimento ? `Anonimizar a partir de ${dataBR(resposta.liberadoEm)}.` : 'Já pode ser anonimizado na lista abaixo.'}
          </p>
          {resposta.impedimento && <p className="mudo">Resposta ao cliente: {resposta.impedimento}</p>}
        </div>
      )}
    </section>
  );
}

function ClientesAAnonimizar() {
  const lista = useQuery({ queryKey: ['lgpd'], queryFn: api.lgpdExclusoes });
  const [anonimizando, setAnonimizando] = useState<ClienteAAnonimizar | null>(null);

  if (lista.isError) return <p className="erro" role="alert">{mensagemDe(lista.error, 'Não foi possível carregar os pedidos.')}</p>;
  if (!lista.isSuccess) return <p className="mudo">Carregando…</p>;
  const clientes = lista.data.clientes;

  return (
    <>
      <h2>Clientes a anonimizar</h2>
      {clientes.length === 0 && <div className="cartao vazio">Nenhum pedido de exclusão aguardando.</div>}
      <div className="lista">
        {clientes.map((c) => (
          <article key={c.id} className="cartao">
            <div className="linha">
              <strong>{c.nome}</strong>
              <span className={`selo${c.pode ? ' urgente' : ''}`}>{c.pode ? 'Pode anonimizar' : `A partir de ${dataBR(c.liberadoEm)}`}</span>
            </div>
            <p className="mudo">Pedido registrado em {quando(c.exclusaoPedidaEm)} · {c.motivo}</p>
            {c.impedimento && <p className="mudo">{c.impedimento}</p>}
            {c.pode && (
              <div className="acoes-do-cartao esquerda">
                <button className="perigo-sec" onClick={() => setAnonimizando(c)}>Anonimizar</button>
              </div>
            )}
          </article>
        ))}
      </div>
      {anonimizando && <Anonimizar cliente={anonimizando} aoFechar={() => setAnonimizando(null)} />}
    </>
  );
}

function Anonimizar({ cliente, aoFechar }: { cliente: ClienteAAnonimizar; aoFechar: () => void }) {
  const cache = useQueryClient();
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<number | null>(null);

  const anonimizar = useMutation({
    mutationFn: () => api.anonimizar(cliente.id, digitado),
    onSuccess: (r) => {
      setFeito(r.observacoesTrocadas);
      void cache.invalidateQueries({ queryKey: ['lgpd'] });
      void cache.invalidateQueries({ queryKey: ['clientes'] });
    },
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível anonimizar.')),
  });

  return (
    <Janela titulo={`Anonimizar ${cliente.nome}`} aoFechar={aoFechar}>
      <h2>Anonimizar cliente</h2>
      {feito !== null ? (
        <>
          <p>
            Pronto. O cadastro e os pedidos passaram a mostrar "Cliente removido"
            {feito > 0 ? `, e ${feito} observação(ões) tiveram nome, CPF ou telefone trocados por [removido]` : ''}.
          </p>
          <p className="mudo">Revise à mão observações antigas que possam citar o cliente por apelido ou com erro de digitação.</p>
          <div className="acoes"><button className="pri" onClick={aoFechar}>Fechar</button></div>
        </>
      ) : (
        <>
          <p>
            <strong>Esta ação não pode ser desfeita.</strong> O nome vira "Cliente removido", documento, telefone e cidade são
            apagados, e o nome sai da descrição e das observações dos pedidos. Pedidos, pagamentos e comprovantes continuam.
          </p>
          <label htmlFor="confirma-nome">Para confirmar, digite o nome do cliente: {cliente.nome}</label>
          <input id="confirma-nome" type="text" value={digitado} onChange={(e) => setDigitado(e.target.value)} autoComplete="off" />
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes">
            <button className="sec" onClick={aoFechar}>Cancelar</button>
            <button
              className="perigo"
              disabled={anonimizar.isPending || !confirmaNome(digitado, cliente.nome)}
              onClick={() => { setErro(''); anonimizar.mutate(); }}
            >
              {anonimizar.isPending ? 'Anonimizando…' : 'Anonimizar'}
            </button>
          </div>
        </>
      )}
    </Janela>
  );
}
