import {
  FORMAS_PAGAMENTO,
  formatarReais,
  lerValorEmCentavos,
  registraPagamentos,
  veValores,
  type FormaPagamento,
  type PedidoFinanceiro,
  type RecebimentoLinha,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ErroApi, api } from '../api';
import { prepararComprovante } from '../comprovante';
import { Janela } from '../components/Janela';
import { useEu } from '../eu';
import { dataBR, quando } from '../formatar';

const mensagemDe = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : e instanceof Error ? e.message : padrao);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * RF-25 a RF-28: recebimentos e entrega dos pedidos de Cliente que saíram da Embalagem. É do Atendimento, da Direção e do
 * Administrador; o setor não vê valores (RF-02).
 */
export function Financeiro() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) return <p className="erro" role="alert">{mensagemDe(eu.error, 'Não foi possível carregar seu perfil.')}</p>;
  if (!veValores(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. O financeiro é do Atendimento.</div>;
  }
  return <Painel podeRegistrar={registraPagamentos(eu.data)} />;
}

function Painel({ podeRegistrar }: { podeRegistrar: boolean }) {
  const dados = useQuery({ queryKey: ['financeiro'], queryFn: api.financeiro, refetchInterval: 20_000, refetchOnWindowFocus: true });
  const [aviso, setAviso] = useState('');

  if (dados.isError) return <p className="erro" role="alert">{mensagemDe(dados.error, 'Não foi possível carregar o financeiro.')}</p>;
  if (!dados.isSuccess) return <p className="mudo">Carregando…</p>;
  const { resumo, pedidos } = dados.data;

  const cartoes = [
    { nome: 'Recebido hoje', valor: resumo.recebidoHojeCentavos, nota: 'no horário de Fortaleza' },
    { nome: 'Últimos 7 dias', valor: resumo.recebido7DiasCentavos, nota: 'hoje e os 6 dias anteriores' },
    { nome: 'Recebido no mês', valor: resumo.recebidoMesCentavos, nota: 'desde o dia 1º' },
    { nome: 'A receber', valor: resumo.aReceberCentavos, nota: 'saldo dos pedidos de Cliente em aberto' },
  ];

  return (
    <>
      <h1>Financeiro e entrega</h1>
      <div className="indicadores">
        {cartoes.map((c) => (
          <div key={c.nome} className="cartao indicador">
            <small>{c.nome}</small>
            <strong>{formatarReais(c.valor)}</strong>
            <small>{c.nota}</small>
          </div>
        ))}
      </div>

      {aviso && <p className="aviso" role="status">{aviso}</p>}
      <h2>{plural(pedidos.length, 'pedido aguardando', 'pedidos aguardando')} cobrança e entrega</h2>
      {pedidos.length === 0 && <div className="cartao vazio">Nenhum pedido saiu da Embalagem esperando cobrança ou entrega.</div>}
      <div className="lista">
        {pedidos.map((p) => (
          <CartaoDoPedido key={p.id} pedido={p} podeRegistrar={podeRegistrar} aoAvisar={setAviso} />
        ))}
      </div>
    </>
  );
}

function CartaoDoPedido({ pedido: p, podeRegistrar, aoAvisar }: { pedido: PedidoFinanceiro; podeRegistrar: boolean; aoAvisar: (t: string) => void }) {
  const [janela, setJanela] = useState<'receber' | 'entregar' | null>(null);
  const [verComprovante, setVerComprovante] = useState<RecebimentoLinha | null>(null);

  return (
    <article className="cartao">
      <div className="linha">
        <strong>#{p.numero}</strong>
        <span>{p.descricao}</span>
        <span className="selo">Entrega {dataBR(p.dataEntrega)}</span>
      </div>

      <dl className="specs">
        <div><dt>Total</dt><dd>{formatarReais(p.totalCentavos)}</dd></div>
        <div><dt>Recebido</dt><dd>{formatarReais(p.recebidoCentavos)}</dd></div>
        <div><dt>Saldo</dt><dd>{formatarReais(p.saldoCentavos)}</dd></div>
        <div><dt>Peças embaladas</dt><dd>{p.pecasEmbaladas ?? '—'}</dd></div>
      </dl>
      <div className="barra-paga" role="img" aria-label={`${p.percentualPago}% pago`}>
        <span style={{ width: `${p.percentualPago}%` }} />
      </div>
      <p className="mudo">{p.percentualPago}% pago{p.totalCentavos === 0 ? ' · pedido sem valor cadastrado' : ''}</p>

      {p.recebimentos.length > 0 && (
        <ul className="recebimentos">
          {p.recebimentos.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{formatarReais(r.valorCentavos)}</strong> · {r.forma} · {r.momento === 'Entrada' ? 'entrada' : 'financeiro'}
                <span className="mudo"> · {quando(r.em)}{r.por ? ` · ${r.por}` : ''}</span>
              </span>
              {r.temComprovante ? (
                <button className="sec" onClick={() => setVerComprovante(r)}>Ver comprovante</button>
              ) : podeRegistrar ? (
                <AnexarComprovante recebimentoId={r.id} aoAvisar={aoAvisar} />
              ) : (
                <span className="aviso">sem comprovante</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeRegistrar && p.recebimentos.some((r) => !r.temComprovante) && (
        <p className="aviso">Há recebimento sem comprovante. Anexe a imagem ou o PDF.</p>
      )}

      {podeRegistrar && (
        <div className="acoes-do-cartao esquerda">
          <button className="sec" disabled={p.saldoCentavos === 0} onClick={() => setJanela('receber')}>Registrar recebimento</button>
          <Link to="/orcamento/$pedidoId" params={{ pedidoId: p.id }} className="botao sec">Ver orçamento</Link>
          <button className="pri" disabled={p.saldoCentavos > 0} title={p.saldoCentavos > 0 ? 'A entrega só é confirmada com saldo zero.' : undefined} onClick={() => setJanela('entregar')}>
            Confirmar entrega
          </button>
        </div>
      )}
      {podeRegistrar && p.saldoCentavos > 0 && <p className="mudo">A entrega só é confirmada com saldo zero.</p>}

      {janela === 'receber' && <JanelaRecebimento pedido={p} aoFechar={() => setJanela(null)} aoAvisar={aoAvisar} />}
      {janela === 'entregar' && <JanelaEntrega pedido={p} aoFechar={() => setJanela(null)} />}
      {verComprovante && <JanelaComprovante recebimento={verComprovante} aoFechar={() => setVerComprovante(null)} />}
    </article>
  );
}

/** Botão para anexar o comprovante a um recebimento que ainda não tem (a imagem é reduzida no aparelho). */
function AnexarComprovante({ recebimentoId, aoAvisar }: { recebimentoId: string; aoAvisar: (t: string) => void }) {
  const cache = useQueryClient();
  const seletor = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: async (arquivo: File) => api.enviarComprovante(recebimentoId, await prepararComprovante(arquivo), arquivo.name),
    onSuccess: () => {
      aoAvisar('');
      return cache.invalidateQueries({ queryKey: ['financeiro'] });
    },
    onError: (e) => aoAvisar(mensagemDe(e, 'Não foi possível enviar o comprovante.')),
  });
  return (
    <>
      <input ref={seletor} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const a = e.target.files?.[0]; if (a) enviar.mutate(a); e.target.value = ''; }} />
      <button className="sec" disabled={enviar.isPending} onClick={() => seletor.current?.click()}>
        {enviar.isPending ? 'Enviando…' : 'Anexar comprovante'}
      </button>
    </>
  );
}

/** RF-27: valor, forma e comprovante. O valor aceita o formato brasileiro (RN-27) e não passa do saldo (RN-25). */
function JanelaRecebimento({ pedido: p, aoFechar, aoAvisar }: { pedido: PedidoFinanceiro; aoFechar: () => void; aoAvisar: (t: string) => void }) {
  const cache = useQueryClient();
  const [valor, setValor] = useState('');
  const [forma, setForma] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState('');

  const registrar = useMutation({
    mutationFn: async () => {
      const centavos = lerValorEmCentavos(valor);
      if (centavos === null) throw new Error('Não entendi o valor. Use, por exemplo, 1.500,00.');
      const r = await api.registrarRecebimento(p.id, { versao: p.versao, valorCentavos: centavos, forma: forma as FormaPagamento });
      let semComprovante = false;
      if (arquivo) {
        try {
          await api.enviarComprovante(r.id, await prepararComprovante(arquivo), arquivo.name);
        } catch {
          semComprovante = true;
        }
      }
      return semComprovante;
    },
    onSuccess: async (semComprovante) => {
      aoAvisar(semComprovante ? 'O recebimento foi registrado, mas o comprovante não subiu. Use "Anexar comprovante".' : '');
      await cache.invalidateQueries({ queryKey: ['financeiro'] });
      aoFechar();
    },
    onError: async (e) => {
      setErro(mensagemDe(e, 'Não foi possível registrar o recebimento.'));
      if (e instanceof ErroApi && e.status === 409) await cache.invalidateQueries({ queryKey: ['financeiro'] });
    },
  });

  function enviar() {
    if (!forma) return setErro('Escolha a forma de pagamento.');
    setErro('');
    registrar.mutate();
  }

  return (
    <Janela titulo={`Registrar recebimento do pedido ${p.numero}`} aoFechar={aoFechar}>
      <h2>Registrar recebimento</h2>
      <p className="mudo">#{p.numero} · {p.descricao} · saldo {formatarReais(p.saldoCentavos)}</p>

      <label htmlFor="rec-valor">Valor recebido (R$)</label>
      <input id="rec-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 500,00" autoComplete="off" />
      <button className="sec" type="button" onClick={() => setValor((p.saldoCentavos / 100).toFixed(2).replace('.', ','))}>
        Receber o saldo todo
      </button>

      <label htmlFor="rec-forma">Forma de pagamento</label>
      <select id="rec-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
        <option value="">Escolha a forma</option>
        {FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}
      </select>

      <label htmlFor="rec-comprovante">Comprovante (imagem ou PDF)</label>
      <input id="rec-comprovante" type="file" accept="image/*,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      <p className="mudo">Todo recebimento deve ter comprovante. Se não tiver agora, anexe depois pelo cartão do pedido.</p>

      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes">
        <button className="sec" onClick={aoFechar}>Cancelar</button>
        <button className="pri" disabled={registrar.isPending} onClick={enviar}>{registrar.isPending ? 'Registrando…' : 'Registrar'}</button>
      </div>
    </Janela>
  );
}

/** RF-28 e RN-30: confirma a entrega, o que conclui o pedido. */
function JanelaEntrega({ pedido: p, aoFechar }: { pedido: PedidoFinanceiro; aoFechar: () => void }) {
  const cache = useQueryClient();
  const [erro, setErro] = useState('');
  const entregar = useMutation({
    mutationFn: () => api.entregar(p.id, { versao: p.versao }),
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: ['financeiro'] }), cache.invalidateQueries({ queryKey: ['fila'] })]);
      aoFechar();
    },
    onError: async (e) => {
      setErro(mensagemDe(e, 'Não foi possível confirmar a entrega.'));
      if (e instanceof ErroApi && e.status === 409) await cache.invalidateQueries({ queryKey: ['financeiro'] });
    },
  });
  return (
    <Janela titulo={`Confirmar a entrega do pedido ${p.numero}`} aoFechar={aoFechar}>
      <h2>Confirmar a entrega</h2>
      <p>
        #{p.numero} · {p.descricao}<br />
        Total {formatarReais(p.totalCentavos)} · recebido {formatarReais(p.recebidoCentavos)} · {p.pecasEmbaladas ?? '—'} peças embaladas.
      </p>
      <p className="mudo">Ao confirmar, o pedido é concluído e sai desta lista.</p>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes">
        <button className="sec" onClick={aoFechar}>Cancelar</button>
        <button className="pri" disabled={entregar.isPending} onClick={() => entregar.mutate()}>{entregar.isPending ? 'Confirmando…' : 'Confirmar entrega'}</button>
      </div>
    </Janela>
  );
}

/** Abre o comprovante: o arquivo não tem endereço público, vem da API com o login. Imagem aparece na janela; PDF abre numa aba. */
function JanelaComprovante({ recebimento: r, aoFechar }: { recebimento: RecebimentoLinha; aoFechar: () => void }) {
  const arquivo = useQuery({
    queryKey: ['comprovante', r.id],
    queryFn: async () => {
      const blob = await api.comprovante(r.id);
      return { url: URL.createObjectURL(blob), tipo: blob.type };
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  return (
    <Janela titulo="Comprovante do recebimento" aoFechar={aoFechar} largura="larga">
      <h2>Comprovante · {formatarReais(r.valorCentavos)} · {r.forma}</h2>
      {arquivo.isError && <p className="erro" role="alert">{mensagemDe(arquivo.error, 'Não foi possível abrir o comprovante.')}</p>}
      {arquivo.isPending && <p className="mudo">Carregando…</p>}
      {arquivo.isSuccess && arquivo.data.tipo === 'application/pdf' && (
        <p><a href={arquivo.data.url} target="_blank" rel="noreferrer">Abrir o PDF numa nova aba</a></p>
      )}
      {arquivo.isSuccess && arquivo.data.tipo !== 'application/pdf' && (
        <a href={arquivo.data.url} target="_blank" rel="noreferrer" title="Abrir inteiro">
          <img className="comprovante" src={arquivo.data.url} alt="Comprovante do recebimento" />
        </a>
      )}
      <div className="acoes"><button className="sec" onClick={aoFechar}>Fechar</button></div>
    </Janela>
  );
}
