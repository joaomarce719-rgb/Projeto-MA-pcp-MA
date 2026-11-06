import { formatarReais, semaforoDoPrazo, veQuadro, type AtencaoDoQuadro, type CartaoDoQuadro, type ColunaDoQuadro } from '@pcp/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErroApi, api } from '../api';
import { Ficha } from '../components/Ficha';
import { useEu } from '../eu';
import { quando } from '../formatar';

/** O quadro se atualiza sozinho a cada 20 s e ao voltar para a aba, como a fila. */
const INTERVALO_MS = 20_000;

const mensagemDe = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao);

/** RF-29 a RF-32: quadro da Direção, só leitura. Clicar num pedido abre a ficha. */
export function Quadro() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) return <p className="erro" role="alert">{mensagemDe(eu.error, 'Não foi possível carregar seu perfil.')}</p>;
  if (!veQuadro(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. O quadro é da Direção.</div>;
  }
  return <Painel />;
}

function Painel() {
  const dados = useQuery({ queryKey: ['quadro'], queryFn: api.quadro, refetchInterval: INTERVALO_MS, refetchOnWindowFocus: true });
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  if (dados.isError) return <p className="erro" role="alert">{mensagemDe(dados.error, 'Não foi possível carregar o quadro.')}</p>;
  if (!dados.isSuccess) return <p className="mudo">Carregando…</p>;
  const q = dados.data;

  const indicadores = [
    { nome: 'Em produção', valor: String(q.emProducaoPedidos), nota: `${q.emProducaoPecas} peças nos setores`, escuro: true },
    { nome: 'Atrasados', valor: String(q.atrasados), nota: 'pedidos fora do prazo', alerta: q.atrasados > 0 },
    { nome: 'Urgentes', valor: String(q.urgentes), nota: 'em aberto' },
    { nome: 'Peças finalizadas hoje', valor: String(q.pecasFinalizadasHoje), nota: 'saíram da Embalagem' },
    { nome: 'A receber', valor: formatarReais(q.aReceberCentavos), nota: 'saldo em aberto' },
    { nome: 'Recebido no mês', valor: formatarReais(q.recebidoMesCentavos), nota: 'desde o dia 1º' },
  ];

  return (
    <>
      <p className="mudo">Direção · somente leitura</p>
      <h1>Quadro da produção</h1>
      <p className="mudo">Atualizado {quando(q.geradoEm)} · horário de Fortaleza</p>

      <div className="indicadores seis">
        {indicadores.map((i) => (
          <div key={i.nome} className={`cartao indicador${i.alerta ? ' alerta' : ''}`}>
            <small>{i.nome}</small>
            <strong>{i.valor}</strong>
            <small>{i.nota}</small>
          </div>
        ))}
      </div>

      <h2>Pedidos por setor</h2>
      <p className="mudo">Role para o lado para ver todos os setores.</p>
      <div className="quadro" role="region" aria-label="Quadro com uma coluna por setor" tabIndex={0}>
        {q.colunas.map((c) => (
          <Coluna key={c.chave} coluna={c} aoAbrir={setFichaAberta} />
        ))}
      </div>

      <div className="quadro-blocos">
        <section className="cartao" aria-labelledby="atencao-titulo">
          <h2 id="atencao-titulo">Atenção</h2>
          {q.atencao.length === 0 && <p className="mudo">Nenhum atraso ou recuperação. Tudo em dia.</p>}
          <ul className="atencao">
            {q.atencao.map((a) => (
              <li key={`${a.tipo}-${a.id}`}>
                <button className="sec" onClick={() => setFichaAberta(a.id)}>
                  <ItemDeAtencao a={a} />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="cartao" aria-labelledby="grafico-titulo">
          <h2 id="grafico-titulo">Peças por setor</h2>
          <GraficoDePecas colunas={q.colunas.slice(0, -1)} />
        </section>
      </div>

      {fichaAberta && <Ficha id={fichaAberta} aoFechar={() => setFichaAberta(null)} />}
    </>
  );
}

function Coluna({ coluna: c, aoAbrir }: { coluna: ColunaDoQuadro; aoAbrir: (id: string) => void }) {
  return (
    <section className={`coluna${c.chave === 'Financeiro' ? ' fin' : ''}${c.chave === 'Concluído' ? ' ok' : ''}`} aria-label={`${c.nome}: ${c.pedidos.length} pedidos, ${c.pecas} peças`}>
      <header>
        <h3>{c.nome}</h3>
        <span className="mudo">
          <b>{c.pedidos.length}</b> · {c.pecas} pç
        </span>
      </header>
      {c.pedidos.length === 0 && <p className="mudo">Sem pedidos</p>}
      {c.pedidos.map((p) => (
        <CartaoDoQuadroPedido key={p.id} p={p} aoAbrir={aoAbrir} concluido={c.chave === 'Concluído'} />
      ))}
    </section>
  );
}

function CartaoDoQuadroPedido({ p, aoAbrir, concluido }: { p: CartaoDoQuadro; aoAbrir: (id: string) => void; concluido: boolean }) {
  const prazo = semaforoDoPrazo(p.dataEntrega);
  return (
    <button type="button" className={`mini-cartao ${concluido ? 'verde' : prazo.cor}`} onClick={() => aoAbrir(p.id)} aria-label={`Pedido ${p.numero}, ${p.descricao}${concluido ? ', concluído hoje' : `, ${prazo.texto}`}`}>
      <span className="linha">
        <strong>#{p.numero}</strong>
        {p.recuperacaoPendente ? (
          <span className="selo recuperacao">Recup.</span>
        ) : (
          p.prioridade !== 'Normal' && <span className={`selo ${p.prioridade === 'Urgente' ? 'urgente' : 'alta'}`}>{p.prioridade}</span>
        )}
      </span>
      <span>{p.descricao}</span>
      <span className="mudo">
        {p.pecas} pç · {p.tipo}
        {concluido ? '' : ` · ${prazo.texto}`}
      </span>
    </button>
  );
}

function ItemDeAtencao({ a }: { a: AtencaoDoQuadro }) {
  return (
    <span className="atencao-item">
      <strong>
        #{a.numero} · {a.descricao}
      </strong>
      <small>
        {a.tipo === 'atraso'
          ? `${semaforoDoPrazo(a.dataEntrega).texto} · em ${a.etapa === 'Financeiro' ? 'Financeiro e entrega' : a.etapa} · ${a.prioridade}`
          : `Recuperação · devolvido pela ${a.devolvidoPor ?? 'produção'}${a.motivo ? `: ${a.motivo}` : ''}`}
      </small>
    </span>
  );
}

/** Barras de peças por setor (as nove primeiras colunas: os 8 setores e o Financeiro). Tem o texto equivalente para leitores de tela. */
function GraficoDePecas({ colunas }: { colunas: ColunaDoQuadro[] }) {
  const maximo = Math.max(1, ...colunas.map((c) => c.pecas));
  const descricao = colunas.map((c) => `${c.chave}: ${c.pecas} peças`).join('; ');
  return (
    <div role="img" aria-label={`Gráfico de barras de peças por setor. ${descricao}`}>
      {colunas.map((c) => (
        <div key={c.chave} className="barra-setor">
          <span>{c.chave}</span>
          <b>{c.pecas}</b>
          <div className="trilha-setor">{c.pecas > 0 && <i className={c.pecas === maximo ? 'maior' : ''} style={{ width: `${Math.max(2, (c.pecas / maximo) * 100)}%` }} />}</div>
        </div>
      ))}
    </div>
  );
}
