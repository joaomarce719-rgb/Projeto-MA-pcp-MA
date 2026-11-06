import {
  ETAPAS_QUE_DEVOLVEM,
  MAQUINAS,
  SETORES,
  ehSetor,
  entregaNosProximosDias,
  estaAtrasado,
  formatarReais,
  progressoDoPedido,
  proximaEtapa,
  trabalhaNaEtapa,
  saldoCentavos,
  semaforoDoPrazo,
  type LoteFila,
  type Perfil,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErroApi, api } from '../api';
import { Ficha } from '../components/Ficha';
import { Janela } from '../components/Janela';
import { useEu } from '../eu';

/** A fila se atualiza sozinha a cada 20 s e ao voltar para a aba (tempo real fica para depois). */
const INTERVALO_MS = 20_000;

/** Só se conclui etapa de produção: pedidos no Financeiro ou concluídos não mostram o botão, nem para o admin. */
function podeConcluir(perfil: Perfil, lote: LoteFila): boolean {
  return ehSetor(lote.etapa) && trabalhaNaEtapa(perfil, lote.etapa);
}

function destinoDe(lote: LoteFila): string {
  if (!ehSetor(lote.etapa)) return lote.etapa;
  return proximaEtapa({
    etapa: lote.etapa,
    tipo: lote.tipo,
    bordado: lote.bordado,
    recuperacaoPendente: lote.recuperacaoPendente,
  });
}

type Aba = 'andamento' | 'concluidos';
type Filtro = 'todos' | 'urgentes' | 'atrasados';

const FILTROS: { id: Filtro; nome: string; vale: (l: LoteFila) => boolean }[] = [
  { id: 'todos', nome: 'Todos', vale: () => true },
  { id: 'urgentes', nome: 'Urgentes', vale: (l) => l.prioridade === 'Urgente' },
  { id: 'atrasados', nome: 'Atrasados', vale: (l) => estaAtrasado(l.dataEntrega) },
];

export function Fila() {
  const eu = useEu();
  const [aba, setAba] = useState<Aba>('andamento');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [concluindo, setConcluindo] = useState<LoteFila | null>(null);
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  const perfil = eu.data;
  const deSetor = perfil?.papel === 'setor';
  // Os indicadores e as contagens usam sempre a lista em andamento; os concluídos só são buscados quando a aba é aberta.
  const andamento = useQuery({
    queryKey: ['fila', 'andamento'],
    queryFn: () => api.fila('andamento'),
    refetchInterval: INTERVALO_MS,
    enabled: eu.isSuccess,
  });
  const concluidos = useQuery({
    queryKey: ['fila', 'concluidos'],
    queryFn: () => api.fila('concluidos'),
    enabled: eu.isSuccess && !deSetor && aba === 'concluidos',
  });
  const lista = aba === 'andamento' ? andamento : concluidos;

  // O erro vem antes do "carregando": se /me falha, a fila nunca é buscada e ficaria "carregando" para sempre.
  const erro = eu.error ?? lista.error;
  if (erro) {
    return (
      <p className="erro" role="alert">
        {erro instanceof ErroApi ? erro.message : 'Não foi possível carregar a fila.'}
      </p>
    );
  }
  if (!eu.isSuccess || !andamento.isSuccess || !lista.isSuccess) return <p className="mudo">Carregando…</p>;

  const abertos = andamento.data.lotes;
  const lotes = lista.data.lotes;
  const visiveis = aba === 'andamento' ? lotes.filter(FILTROS.find((f) => f.id === filtro)!.vale) : lotes;
  const titulo = deSetor ? eu.data.setor : 'Pedidos';

  return (
    <>
      <h1>{titulo}</h1>
      {!deSetor && <Indicadores lotes={abertos} />}

      {!deSetor && (
        <div className="filtros" role="group" aria-label="Mostrar pedidos">
          <button type="button" aria-pressed={aba === 'andamento'} onClick={() => setAba('andamento')}>
            Em andamento <span className="cont">{abertos.length}</span>
          </button>
          <button type="button" aria-pressed={aba === 'concluidos'} onClick={() => setAba('concluidos')}>
            Concluídos
          </button>
        </div>
      )}

      {aba === 'andamento' && (
        <div className="filtros" role="group" aria-label="Filtrar a fila">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.nome} <span className="cont">{lotes.filter(f.vale).length}</span>
            </button>
          ))}
        </div>
      )}

      <p className="mudo">
        {visiveis.length} {visiveis.length === 1 ? 'pedido' : 'pedidos'} · {visiveis.reduce((s, l) => s + l.quantidade, 0)} peças
      </p>

      {visiveis.length === 0 && (
        <div className="cartao vazio">
          {aba === 'concluidos'
            ? 'Nenhum pedido concluído ainda.'
            : lotes.length === 0
              ? 'Fila zerada. Quando o setor anterior concluir, o pedido aparece aqui.'
              : `Nenhum pedido ${filtro === 'urgentes' ? 'urgente' : 'atrasado'} na fila.`}
        </div>
      )}

      <div className="lista">
        {visiveis.map((l) => (
          <CartaoDoPedido
            key={l.id}
            lote={l}
            perfil={eu.data}
            aoVerFicha={() => setFichaAberta(l.id)}
            aoConcluir={() => setConcluindo(l)}
          />
        ))}
      </div>
      {concluindo && <ConfirmarConclusao lote={concluindo} aoFechar={() => setConcluindo(null)} />}
      {fichaAberta && <Ficha id={fichaAberta} aoFechar={() => setFichaAberta(null)} />}
    </>
  );
}

/** RF-05: o retrato do dia para atendimento, direção e admin. */
function Indicadores({ lotes }: { lotes: LoteFila[] }) {
  const emProducao = lotes.filter((l) => (SETORES as readonly string[]).includes(l.etapa));
  const noFinanceiro = lotes.filter((l) => l.etapa === 'Financeiro');
  const daSemana = lotes.filter((l) => entregaNosProximosDias(l.dataEntrega, 7));
  const atrasados = lotes.filter((l) => estaAtrasado(l.dataEntrega));
  const pecas = (ls: LoteFila[]) => ls.reduce((s, l) => s + l.quantidade, 0);

  // Valor a receber: saldo dos pedidos de Cliente em aberto (o servidor só manda os valores para atendimento, direção e admin).
  const aReceber = lotes.filter((l) => l.tipo === 'Cliente').reduce((s, l) => s + saldoCentavos(l.totalCentavos ?? 0, l.recebidoCentavos ?? 0), 0);

  const cartoes: { nome: string; valor: number | string; sub: string; alerta?: boolean }[] = [
    { nome: 'Em produção', valor: emProducao.length, sub: `${pecas(emProducao)} peças nos setores` },
    { nome: 'Aguardando o financeiro', valor: noFinanceiro.length, sub: 'no Financeiro e entrega' },
    { nome: 'Valor a receber', valor: formatarReais(aReceber), sub: 'saldo dos pedidos em aberto' },
    { nome: 'Entregas da semana', valor: daSemana.length, sub: 'hoje e nos próximos 6 dias' },
    { nome: 'Atrasados', valor: atrasados.length, sub: 'fora do prazo', alerta: atrasados.length > 0 },
  ];
  return (
    <div className="indicadores">
      {cartoes.map((c) => (
        <div key={c.nome} className={`cartao indicador${c.alerta ? ' alerta' : ''}`}>
          <span className="mudo">{c.nome}</span>
          <strong>{c.valor}</strong>
          <small>{c.sub}</small>
        </div>
      ))}
    </div>
  );
}

function CartaoDoPedido({ lote: l, perfil, aoVerFicha, aoConcluir }: { lote: LoteFila; perfil: Perfil; aoVerFicha: () => void; aoConcluir: () => void }) {
  const concluido = l.etapa === 'Concluído';
  const prazo = semaforoDoPrazo(l.dataEntrega);
  const progresso = progressoDoPedido(l);

  return (
    <article className={`cartao lote prazo-${concluido ? 'concluido' : prazo.cor}`}>
      <div className="linha">
        <strong>#{l.numero}</strong>
        <span className={`selo ${l.prioridade.toLowerCase()}`}>{l.prioridade}</span>
        <span className="selo">{l.tipo}</span>
        {perfil.papel !== 'setor' && <span className="selo">{l.etapa}</span>}
        {l.recuperacaoPendente && <span className="selo recuperacao">Recuperação</span>}
      </div>
      <p>{l.descricao}</p>
      {l.recuperacaoPendente && l.motivoRecuperacao && (
        <p className="banner-rec">
          <strong>Devolvido ao Design:</strong> {l.motivoRecuperacao}
        </p>
      )}
      {perfil.papel !== 'setor' && (
        <div className="progresso">
          <TrilhaDeEtapas lote={l} />
          <span className="mudo">
            {concluido ? 'Todas as etapas concluídas' : `${progresso.feitas} de ${progresso.total} etapas · faltam ${progresso.total - progresso.feitas}`}
          </span>
        </div>
      )}
      <div className="linha">
        {concluido ? <span className="prazo verde">Concluído</span> : <span className={`prazo ${prazo.cor}`}>{prazo.texto}</span>}
        <span className="mudo">{l.quantidade} peças</span>
        {perfil.papel !== 'setor' && l.tipo === 'Cliente' && l.totalCentavos !== undefined && <SaldoDoPedido lote={l} />}
        <span className="acoes-do-cartao">
          <button className="sec" onClick={aoVerFicha}>
            Ver ficha
          </button>
          {podeConcluir(perfil, l) && (
            <button className="pri" onClick={aoConcluir}>
              Concluir
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

/** Um segmento por etapa da rota (RF-07): feita, atual, a fazer, ou Bordado riscado quando o pedido não tem bordado. */
function TrilhaDeEtapas({ lote: l }: { lote: LoteFila }) {
  const todas: string[] = [...SETORES, ...(l.tipo === 'Cliente' ? ['Financeiro'] : []), 'Concluído'];
  const passos = todas.filter((e) => e !== 'Bordado' || l.bordado);
  const atual = passos.indexOf(l.etapa);
  const progresso = progressoDoPedido(l);
  return (
    <span className="trilha-etapas" role="img" aria-label={`${progresso.feitas} de ${progresso.total} etapas concluídas`}>
      {todas.map((e) => {
        if (e === 'Bordado' && !l.bordado) return <i key={e} className="x" title="Bordado: não se aplica" />;
        const i = passos.indexOf(e);
        const classe = l.etapa === 'Concluído' || i < atual ? 'f' : i === atual ? (l.recuperacaoPendente ? 'r' : 'a') : '';
        return <i key={e} className={classe} title={e === 'Financeiro' ? 'Financeiro e entrega' : e} />;
      })}
    </span>
  );
}

/** Saldo a receber, ou "quitado" (valores só para atendimento, direção e admin). */
function SaldoDoPedido({ lote: l }: { lote: LoteFila }) {
  const saldo = saldoCentavos(l.totalCentavos ?? 0, l.recebidoCentavos ?? 0);
  if ((l.totalCentavos ?? 0) === 0) return <span className="mudo">Sem valor</span>;
  return saldo > 0 ? (
    <span className="mudo">
      Saldo <strong>{formatarReais(saldo)}</strong>
    </span>
  ) : (
    <span className="mudo">
      Quitado <strong>{formatarReais(l.totalCentavos ?? 0)}</strong>
    </span>
  );
}

function ConfirmarConclusao({ lote, aoFechar }: { lote: LoteFila; aoFechar: () => void }) {
  const cache = useQueryClient();
  const [modo, setModo] = useState<'concluir' | 'devolver'>('concluir');
  const [maquina, setMaquina] = useState<string>('');
  const [pecas, setPecas] = useState(String(lote.quantidade));
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const aoTerminar = async () => {
    await Promise.all([cache.invalidateQueries({ queryKey: ['fila'] }), cache.invalidateQueries({ queryKey: ['ficha'] })]);
    aoFechar();
  };
  const aoFalhar = async (e: unknown) => {
    setErro(e instanceof ErroApi ? e.message : 'Não foi possível concluir.');
    // Conflito: o pedido já mudou. Atualiza a fila para a pessoa ver o estado real.
    if (e instanceof ErroApi && e.status === 409) await cache.invalidateQueries({ queryKey: ['fila'] });
  };

  const concluir = useMutation({
    mutationFn: () => {
      const n = Number(pecas);
      return api.concluir(lote.id, {
        versao: lote.versao,
        ...(lote.etapa === 'Impressão' && maquina ? { maquina: maquina as (typeof MAQUINAS)[number] } : {}),
        ...(lote.etapa === 'Embalagem' && Number.isInteger(n) ? { pecas: n } : {}),
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
    },
    onSuccess: aoTerminar,
    onError: aoFalhar,
  });

  const devolver = useMutation({
    mutationFn: () => api.devolver(lote.id, { versao: lote.versao, motivo: motivo.trim() }),
    onSuccess: aoTerminar,
    onError: aoFalhar,
  });

  const podeDevolver = ETAPAS_QUE_DEVOLVEM.includes(lote.etapa);
  const cabecalho = (
    <p className="mudo">
      Pedido #{lote.numero} · {lote.descricao}
    </p>
  );

  if (modo === 'devolver') {
    const curto = motivo.trim().length < 3;
    return (
      <Janela titulo="Devolver para o Design" aoFechar={aoFechar}>
        <h2>Devolver para o Design?</h2>
        {cabecalho}
        <p>O pedido fica marcado como Recuperação até o Design concluir e depois volta para a Impressão.</p>
        <label htmlFor="motivo">Motivo da devolução *</label>
        <textarea
          id="motivo"
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: 3 peças M com falha na sublimação da manga."
        />
        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}
        <div className="acoes">
          <button className="sec" onClick={() => { setErro(''); setModo('concluir'); }}>
            Voltar
          </button>
          <button
            className="perigo"
            disabled={devolver.isPending}
            onClick={() => {
              if (curto) return setErro('Descreva o motivo da devolução.');
              setErro('');
              devolver.mutate();
            }}
          >
            {devolver.isPending ? 'Devolvendo…' : 'Devolver para o Design'}
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo={`Concluir ${lote.etapa}`} aoFechar={aoFechar}>
      <h2>Concluir {lote.etapa}?</h2>
      {cabecalho}

      {lote.etapa === 'Impressão' && (
        <fieldset>
          <legend>Máquina usada *</legend>
          <div className="opcoes">
            {MAQUINAS.map((m) => (
              <label key={m} className={maquina === m ? 'marcada' : ''}>
                <input type="radio" name="maquina" value={m} checked={maquina === m} onChange={() => setMaquina(m)} />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {lote.etapa === 'Embalagem' && (
        <>
          <label htmlFor="pecas">Quantidade final de peças *</label>
          <input id="pecas" type="number" min={1} step={1} value={pecas} onChange={(e) => setPecas(e.target.value)} />
          {Number(pecas) !== lote.quantidade && <p className="aviso">Previsto: {lote.quantidade} peças.</p>}
        </>
      )}

      <label htmlFor="nota">Observação (opcional)</label>
      <textarea id="nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />

      <p>
        Depois de confirmar, o pedido sai da sua fila e vai para <strong>{destinoDe(lote)}</strong>.
      </p>
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      <div className="acoes">
        <button className="sec" onClick={aoFechar}>
          Voltar
        </button>
        <button className="pri" disabled={concluir.isPending} onClick={() => { setErro(''); concluir.mutate(); }}>
          {concluir.isPending ? 'Concluindo…' : 'Sim, concluir'}
        </button>
      </div>
      {podeDevolver && (
        <button className="perigo-sec" onClick={() => { setErro(''); setModo('devolver'); }}>
          Devolver para o Design
        </button>
      )}
    </Janela>
  );
}
