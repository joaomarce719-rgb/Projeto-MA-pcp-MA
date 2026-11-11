import {
  FORMAS_PAGAMENTO,
  FOTOS_POR_PEDIDO,
  PRIORIDADES,
  PUNHOS,
  SETORES,
  TAMANHOS,
  clienteBody,
  diaEmFortaleza,
  proximaFaixa,
  rotuloDaFaixa,
  entradaSugeridaCentavos,
  erroDaDataDeEntrega,
  erroDoRecebimento,
  formatarReais,
  lerValorEmCentavos,
  modoDoProduto,
  nomesDosAdicionais,
  pedidoBody,
  precificarItem,
  quantidadeDaGrade,
  somarDias,
  tituloDoProduto,
  type ClienteLinha,
  type Grade,
  type ModoGrade,
  type OrcamentoDoPedido,
  type Prioridade,
  type ProdutoDoCatalogo,
  abrePedidos,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ErroApi, api } from '../api';
import { FolhaDoOrcamento } from '../components/FolhaDoOrcamento';
import { Janela } from '../components/Janela';
import { dataBR } from '../formatar';
import { prepararComprovante } from '../comprovante';
import { prepararFoto } from '../imagem';
import { useEu } from '../eu';

interface ItemEd {
  /** Nome do produto, como está no catálogo. */
  produto: string;
  malha: string;
  modo: ModoGrade;
  grade: Record<string, string>;
  adicionais: { patch: boolean; punho: boolean; golaV: boolean };
}

/** Foto escolhida, já reduzida, esperando o pedido ser criado para subir. */
interface FotoRascunho {
  nome: string;
  imagem: Blob;
  previa: string;
}

interface Rascunho {
  tipo: 'Cliente' | 'Feira';
  cliente: ClienteLinha | null;
  novoCliente: boolean;
  nc: { nome: string; documento: string; telefone: string; cidade: string };
  descricao: string;
  itens: ItemEd[];
  prioridade: Prioridade;
  dataEntrega: string;
  bordado: boolean;
  punho: string;
  detalhes: string;
  fotos: FotoRascunho[];
  /** Entrada, como a pessoa digitou (formato brasileiro, RN-27). Vazio = sem entrada (RN-24). */
  entradaValor: string;
  /** RN-26: nenhuma forma vem marcada. */
  entradaForma: string;
  comprovante: File | null;
}

const PASSOS = ['Cliente', 'Produtos', 'Produção', 'Revisão'] as const;
/** Só para validar enquanto o cliente novo ainda não foi cadastrado. */
const ID_PROVISORIO = '00000000-0000-4000-8000-000000000000';

/** O produto vem do catálogo: a grade (adulto ou infantil) e a malha seguem dele. */
const itemDoCatalogo = (p: ProdutoDoCatalogo): ItemEd => ({
  produto: p.nome,
  malha: p.malha,
  modo: modoDoProduto(p.nome),
  grade: {},
  adicionais: { patch: false, punho: false, golaV: false },
});

const novoRascunho = (): Rascunho => ({
  tipo: 'Cliente',
  cliente: null,
  novoCliente: false,
  nc: { nome: '', documento: '', telefone: '', cidade: '' },
  descricao: '',
  itens: [],
  prioridade: 'Normal',
  dataEntrega: somarDias(diaEmFortaleza(), 10),
  bordado: false,
  punho: 'Sem punho',
  detalhes: '',
  fotos: [],
  entradaValor: '',
  entradaForma: '',
  comprovante: null,
});

/** Campo de dinheiro vazio vale zero; texto que não dá para entender vale NaN, e o passo da Revisão recusa. */
function reais(texto: string): number {
  return texto.trim() === '' ? 0 : (lerValorEmCentavos(texto) ?? Number.NaN);
}

function numeros(grade: Record<string, string>): Grade {
  return Object.fromEntries(Object.entries(grade).map(([t, v]) => [t, v === '' ? 0 : Number(v)]));
}

const pecasDoItem = (i: ItemEd) => quantidadeDaGrade(i.modo, numeros(i.grade));

/** Preço do item pelo catálogo (a API refaz a conta ao abrir o pedido; aqui é só para mostrar). */
function precoDoItem(i: ItemEd, catalogo: ProdutoDoCatalogo[]) {
  const p = catalogo.find((x) => x.nome === i.produto);
  return p ? precificarItem({ quantidade: pecasDoItem(i), faixas: p.faixas, adicionais: i.adicionais }) : null;
}

/** Pedido de Feira não é cobrado. */
const totalDoRascunho = (r: Rascunho, catalogo: ProdutoDoCatalogo[]) =>
  r.tipo === 'Cliente' ? r.itens.reduce((soma, i) => soma + (precoDoItem(i, catalogo)?.subtotalCentavos ?? 0), 0) : 0;

/** O orçamento do pedido ainda não aberto (prévia): mesma folha do orçamento de verdade, sem número. */
function orcamentoDoRascunho(r: Rascunho, catalogo: ProdutoDoCatalogo[]): OrcamentoDoPedido {
  const itens = r.itens.map((i) => {
    const p = precoDoItem(i, catalogo);
    return {
      produto: i.produto,
      malha: i.malha,
      modo: i.modo,
      grade: numeros(i.grade),
      quantidade: pecasDoItem(i),
      adicionais: nomesDosAdicionais(i.adicionais),
      unitarioCentavos: p ? p.precoUnitarioCentavos + p.adicionaisUnitarioCentavos : 0,
      subtotalCentavos: p?.subtotalCentavos ?? 0,
    };
  });
  const total = itens.reduce((soma, i) => soma + i.subtotalCentavos, 0);
  const entrada = Number.isFinite(reais(r.entradaValor)) ? reais(r.entradaValor) : 0;
  const nome = r.novoCliente ? r.nc.nome.trim() || 'Novo cliente' : (r.cliente?.nome ?? 'Cliente');
  const dados = r.novoCliente ? r.nc : r.cliente;
  return {
    numero: 0,
    tipo: 'Cliente',
    descricao: nome,
    cliente: { nome, documento: dados?.documento || null, telefone: dados?.telefone || null, cidade: dados?.cidade || null },
    criadoEm: diaEmFortaleza(),
    dataEntrega: r.dataEntrega,
    prioridade: r.prioridade,
    bordado: bordadoEfetivo(r),
    itens,
    pecas: itens.reduce((soma, i) => soma + i.quantidade, 0),
    totalCentavos: total,
    recebimentos: entrada > 0 ? [{ valorCentavos: entrada, forma: r.entradaForma || 'a definir', dia: diaEmFortaleza() }] : [],
    recebidoCentavos: entrada,
    saldoCentavos: Math.max(0, total - entrada),
  };
}

/** RN-13: com patch o pedido tem bordado, mesmo que a pessoa não tenha marcado. */
const bordadoEfetivo = (r: Rascunho) => r.bordado || r.itens.some((i) => i.adicionais.patch);

function montarCorpo(r: Rascunho, clienteId: string | undefined) {
  return {
    tipo: r.tipo,
    clienteId,
    descricao: r.descricao,
    prioridade: r.prioridade,
    dataEntrega: r.dataEntrega,
    bordado: bordadoEfetivo(r),
    punho: r.punho,
    detalhes: r.detalhes,
    itens: r.itens.map((i) => ({ produto: i.produto, modo: i.modo, grade: numeros(i.grade), adicionais: i.adicionais })),
    // O valor total não vai: a API calcula pelo catálogo. Pedido de Feira não tem entrada.
    ...(r.tipo === 'Cliente' && r.entradaValor.trim() !== ''
      ? { entrada: { valorCentavos: reais(r.entradaValor), forma: r.entradaForma || undefined } }
      : {}),
  };
}

/** RF-13: valida o passo com as mesmas regras do servidor. Devolve a mensagem, ou null se está tudo certo. */
function validar(r: Rascunho, passo: number, catalogo: ProdutoDoCatalogo[]): string | null {
  if (passo === 1) {
    if (r.tipo === 'Feira') return r.descricao.trim().length >= 3 ? null : 'Descreva a feira para continuar.';
    if (r.novoCliente) return clienteBody.safeParse(r.nc).success ? null : 'Informe o nome do novo cliente.';
    return r.cliente ? null : 'Escolha um cliente salvo ou cadastre um novo.';
  }
  if (passo === 4 && r.tipo === 'Cliente' && r.entradaValor.trim() !== '') {
    const entrada = reais(r.entradaValor);
    if (Number.isNaN(entrada)) return 'Não entendi o valor da entrada. Use, por exemplo, 500,00.';
    // RN-25 e RN-26: dentro do total calculado e com forma de pagamento.
    const problema = erroDoRecebimento(totalDoRascunho(r, catalogo), entrada, r.entradaForma);
    if (problema) return problema;
  }
  const lido = pedidoBody.safeParse(montarCorpo(r, r.cliente?.id ?? ID_PROVISORIO));
  const problemas = lido.success ? [] : lido.error.issues;
  const campos = passo === 2 ? ['itens'] : passo === 3 ? ['dataEntrega', 'bordado', 'punho'] : null;
  const doPasso = campos ? problemas.filter((p) => campos.includes(String(p.path[0]))) : problemas;
  if (passo === 3) {
    const data = erroDaDataDeEntrega(r.dataEntrega);
    if (data) return data;
  }
  return doPasso[0]?.message ?? null;
}

/** Maiúsculas e sem acento, para comparar na busca. */
const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function useAtrasado<T>(valor: T, ms = 250): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

export function NovoPedido() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) {
    return (
      <p className="erro" role="alert">
        {eu.error instanceof ErroApi ? eu.error.message : 'Não foi possível carregar seu perfil.'}
      </p>
    );
  }
  if (!abrePedidos(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. Só o Atendimento abre pedidos.</div>;
  }
  return <Assistente />;
}

function Assistente() {
  const cache = useQueryClient();
  const [passo, setPasso] = useState(1);
  const [r, setR] = useState<Rascunho>(novoRascunho);
  const [erro, setErro] = useState('');
  const [criado, setCriado] = useState<{ id: string; numero: number; tipo: Rascunho['tipo']; fotosComFalha: number; comprovanteComFalha: boolean } | null>(null);
  const catalogo = useQuery({ queryKey: ['catalogo'], queryFn: api.catalogo, staleTime: 5 * 60_000 });
  const produtos = catalogo.data?.produtos ?? [];

  const mudar = (parte: Partial<Rascunho>) => {
    setErro('');
    setR((antes) => ({ ...antes, ...parte }));
  };

  const abrir = useMutation({
    mutationFn: async () => {
      let clienteId = r.cliente?.id;
      if (r.tipo === 'Cliente' && r.novoCliente) {
        const { cliente } = await api.criarCliente(clienteBody.parse(r.nc));
        clienteId = cliente.id;
        // Se o pedido falhar logo depois, uma nova tentativa usa este cliente em vez de cadastrar outro.
        setR((antes) => ({ ...antes, cliente, novoCliente: false }));
      }
      const pedido = await api.criarPedido(pedidoBody.parse(montarCorpo(r, clienteId)));
      // As fotos sobem depois do pedido (precisam do número dele). Se alguma falhar, o pedido já existe: avisamos e
      // a pessoa adiciona a foto pela ficha, em vez de perder o pedido.
      let fotosComFalha = 0;
      for (const foto of r.fotos) {
        try {
          await api.enviarFoto(pedido.id, foto.imagem, foto.nome);
        } catch {
          fotosComFalha += 1;
        }
      }
      r.fotos.forEach((f) => URL.revokeObjectURL(f.previa));
      // O comprovante da entrada também sobe depois (precisa do recebimento criado). Se falhar, a ficha do Financeiro o aceita depois.
      let comprovanteComFalha = false;
      if (r.comprovante && pedido.entradaId) {
        try {
          await api.enviarComprovante(pedido.entradaId, await prepararComprovante(r.comprovante), r.comprovante.name);
        } catch {
          comprovanteComFalha = true;
        }
      }
      return { id: pedido.id, numero: pedido.numero, tipo: r.tipo, fotosComFalha, comprovanteComFalha };
    },
    onSuccess: async (res) => {
      await Promise.all([cache.invalidateQueries({ queryKey: ['fila'] }), cache.invalidateQueries({ queryKey: ['clientes'] })]);
      setCriado(res);
    },
    onError: (e) => setErro(e instanceof ErroApi ? e.message : 'Não foi possível abrir o pedido.'),
  });

  if (catalogo.isError) {
    return (
      <p className="erro" role="alert">
        {catalogo.error instanceof ErroApi ? catalogo.error.message : 'Não foi possível carregar o catálogo de produtos.'}
      </p>
    );
  }
  if (!catalogo.isSuccess) return <p className="mudo">Carregando o catálogo…</p>;

  if (criado !== null) {
    return (
      <div className="cartao vazio">
        <h1>Pedido #{criado.numero} aberto</h1>
        <p>Ele já está na fila do Design.</p>
        {criado.fotosComFalha > 0 && (
          <p className="aviso" role="alert">
            {criado.fotosComFalha === 1 ? '1 foto não subiu' : `${criado.fotosComFalha} fotos não subiram`}. Abra a ficha do pedido e use "Adicionar foto".
          </p>
        )}
        {criado.comprovanteComFalha && (
          <p className="aviso" role="alert">
            O comprovante da entrada não subiu. Anexe-o depois pela tela do Financeiro.
          </p>
        )}
        <div className="acoes">
          <button
            className="sec"
            onClick={() => {
              setR(novoRascunho());
              setPasso(1);
              setCriado(null);
            }}
          >
            Abrir outro pedido
          </button>
          {criado.tipo === 'Cliente' && (
            <Link to="/orcamento/$pedidoId" params={{ pedidoId: criado.id }} className="botao sec">
              Ver o orçamento
            </Link>
          )}
          <Link to="/fila" className="botao pri">
            Ver os pedidos
          </Link>
        </div>
      </div>
    );
  }

  const avancar = () => {
    const problema = validar(r, passo, produtos);
    if (problema) return setErro(problema);
    setErro('');
    setPasso(passo + 1);
  };
  const confirmar = () => {
    // Revalida tudo: a pessoa pode ter voltado e mudado algo.
    for (const p of [1, 2, 3, 4]) {
      const problema = validar(r, p, produtos);
      if (problema) {
        setPasso(Math.min(p, 4));
        return setErro(problema);
      }
    }
    setErro('');
    abrir.mutate();
  };

  return (
    <>
      <h1>Novo pedido</h1>
      <ol className="passos" aria-label="Passos do novo pedido">
        {PASSOS.map((nome, i) => (
          <li key={nome} className={i + 1 === passo ? 'atual' : i + 1 < passo ? 'feito' : ''} aria-current={i + 1 === passo ? 'step' : undefined}>
            <span>{i + 1 < passo ? '✓' : i + 1}</span> {nome}
          </li>
        ))}
      </ol>

      <div className="cartao">
        {passo === 1 && <PassoCliente r={r} mudar={mudar} />}
        {passo === 2 && <PassoProdutos r={r} mudar={mudar} catalogo={produtos} />}
        {passo === 3 && <PassoProducao r={r} mudar={mudar} />}
        {passo === 4 && <PassoRevisao r={r} mudar={mudar} catalogo={produtos} />}

        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}
        <div className="acoes">
          {passo > 1 && (
            <button className="sec" onClick={() => { setErro(''); setPasso(passo - 1); }}>
              Voltar
            </button>
          )}
          {passo < 4 ? (
            <button className="pri" onClick={avancar}>
              Continuar
            </button>
          ) : (
            <button className="pri" disabled={abrir.isPending} onClick={confirmar}>
              {abrir.isPending ? 'Abrindo…' : 'Confirmar e enviar para o Design'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

type Passo = { r: Rascunho; mudar: (p: Partial<Rascunho>) => void };

function Opcoes<T extends string>({ valor, opcoes, aoMudar, nome, desativadas }: { valor: T; opcoes: readonly T[]; aoMudar: (v: T) => void; nome: string; desativadas?: readonly T[] }) {
  return (
    <div className="opcoes">
      {opcoes.map((o) => (
        <label key={o} className={`${valor === o ? 'marcada' : ''}${desativadas?.includes(o) ? ' desativada' : ''}`}>
          <input type="radio" name={nome} value={o} checked={valor === o} disabled={desativadas?.includes(o)} onChange={() => aoMudar(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

function PassoCliente({ r, mudar }: Passo) {
  const [busca, setBusca] = useState('');
  const termo = useAtrasado(busca.trim());
  const clientes = useQuery({
    queryKey: ['clientes', termo],
    queryFn: () => api.clientes(termo),
    enabled: r.tipo === 'Cliente' && !r.novoCliente,
    staleTime: 30_000,
  });

  return (
    <>
      <h2>1. Cliente</h2>
      <fieldset>
        <legend>Tipo do pedido</legend>
        <Opcoes nome="tipo" valor={r.tipo} opcoes={['Cliente', 'Feira'] as const} aoMudar={(tipo) => mudar({ tipo })} />
      </fieldset>

      {r.tipo === 'Feira' && (
        <>
          <label htmlFor="descricao">Descrição da feira</label>
          <input id="descricao" value={r.descricao} onChange={(e) => mudar({ descricao: e.target.value })} placeholder="Ex.: Feira do Centro · coleção infantil" />
          <p className="mudo">Pedido de feira termina na Embalagem, sem cobrança.</p>
        </>
      )}

      {r.tipo === 'Cliente' && !r.novoCliente && (
        <>
          <label htmlFor="busca">Buscar cliente salvo</label>
          <input id="busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, documento ou cidade" autoComplete="off" />
          <div className="clientes">
            {clientes.isPending && <p className="mudo">Buscando…</p>}
            {clientes.isError && <p className="erro">Não foi possível buscar os clientes.</p>}
            {clientes.data?.clientes.length === 0 && <p className="mudo">Nenhum cliente encontrado. Use "Novo cliente".</p>}
            {clientes.data?.clientes.map((c) => (
              <button key={c.id} type="button" className={`cliente${r.cliente?.id === c.id ? ' marcado' : ''}`} aria-pressed={r.cliente?.id === c.id} onClick={() => mudar({ cliente: c })}>
                <strong>{c.nome}</strong>
                <span className="mudo">{[c.cidade, c.documento].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
          <button className="sec" type="button" onClick={() => mudar({ novoCliente: true, cliente: null })}>
            Novo cliente
          </button>
        </>
      )}

      {r.tipo === 'Cliente' && r.novoCliente && (
        <>
          <h3>Novo cliente</h3>
          {(['nome', 'documento', 'telefone', 'cidade'] as const).map((campo) => (
            <div key={campo}>
              <label htmlFor={`nc-${campo}`}>
                {{ nome: 'Nome ou razão social', documento: 'CPF/CNPJ (opcional)', telefone: 'Telefone (opcional)', cidade: 'Cidade (opcional)' }[campo]}
              </label>
              <input id={`nc-${campo}`} value={r.nc[campo]} onChange={(e) => mudar({ nc: { ...r.nc, [campo]: e.target.value } })} />
            </div>
          ))}
          <button className="sec" type="button" onClick={() => mudar({ novoCliente: false })}>
            Usar um cliente salvo
          </button>
        </>
      )}
    </>
  );
}

function PassoProdutos({ r, mudar, catalogo }: Passo & { catalogo: ProdutoDoCatalogo[] }) {
  const [busca, setBusca] = useState('');
  const termo = useAtrasado(semAcento(busca.trim()), 150);
  const palavras = termo.split(' ').filter(Boolean);
  // Todas as palavras têm de aparecer, em qualquer ordem e sem diferenciar acento ("calcao dry" acha "Calção ... Dry Fit").
  const resultados = palavras.length ? catalogo.filter((p) => palavras.every((w) => semAcento(`${p.nome} ${p.malha}`).includes(w))).slice(0, 8) : [];
  const trocar = (i: number, parte: Partial<ItemEd>) => mudar({ itens: r.itens.map((item, k) => (k === i ? { ...item, ...parte } : item)) });
  const total = r.itens.reduce((s, i) => s + pecasDoItem(i), 0);
  const cobrado = r.tipo === 'Cliente';

  return (
    <>
      <h2>2. Produtos</h2>
      <label htmlFor="busca-produto">Buscar produto no catálogo</label>
      <input id="busca-produto" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: camisa dry fit, calção, colete" autoComplete="off" />
      {termo && resultados.length === 0 && <p className="mudo">Nenhum produto encontrado. Tente outra palavra.</p>}
      <div className="clientes">
        {resultados.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cliente"
            onClick={() => {
              mudar({ itens: [...r.itens, itemDoCatalogo(p)] });
              setBusca('');
            }}
          >
            <strong>{tituloDoProduto(p.nome)}</strong>
            <span className="mudo">
              Malha {tituloDoProduto(p.malha)}
              {cobrado && ` · ${p.faixas.map((x, j) => `${formatarReais(x.centavos)} (${rotuloDaFaixa(p.faixas, j)})`).join(' · ')}`}
            </span>
          </button>
        ))}
      </div>
      {r.itens.length === 0 && <p className="mudo">Busque e escolha o primeiro produto do pedido.</p>}

      {r.itens.map((item, i) => {
        const pecas = pecasDoItem(item);
        const preco = precoDoItem(item, catalogo);
        const produto = catalogo.find((p) => p.nome === item.produto);
        return (
          <section key={`${item.produto}-${i}`} className="item-ed" aria-label={`Produto ${i + 1}`}>
            <div className="linha">
              <strong>{tituloDoProduto(item.produto)}</strong>
              <span className="selo">Malha {tituloDoProduto(item.malha)}</span>
              <span className="selo">{item.modo === 'adulto' ? 'Adulto' : 'Infantil'}</span>
              <button className="sec" type="button" onClick={() => mudar({ itens: r.itens.filter((_, k) => k !== i) })}>
                Remover
              </button>
            </div>
            <div className="grade-ed">
              {TAMANHOS[item.modo].map((t) => (
                <div key={t}>
                  <label htmlFor={`g-${i}-${t}`}>{t}</label>
                  <input
                    id={`g-${i}-${t}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    step={1}
                    value={item.grade[t] ?? ''}
                    onChange={(e) => trocar(i, { grade: { ...item.grade, [t]: e.target.value.replace(/\D/g, '').slice(0, 3) } })}
                  />
                </div>
              ))}
            </div>
            <fieldset>
              <legend>Adicionais por peça</legend>
              <div className="opcoes">
                {([['patch', 'Patch'], ['punho', 'Punho'], ['golaV', 'Gola V']] as const).map(([chave, nome]) => (
                  <label key={chave} className={item.adicionais[chave] ? 'marcada' : ''}>
                    <input type="checkbox" checked={item.adicionais[chave]} onChange={(e) => trocar(i, { adicionais: { ...item.adicionais, [chave]: e.target.checked } })} />
                    {nome}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="mudo">
              {pecas} {pecas === 1 ? 'peça' : 'peças'} neste produto
              {cobrado && preco && pecas > 0 && (
                <>
                  {' '}· {formatarReais(preco.precoUnitarioCentavos + preco.adicionaisUnitarioCentavos)} por peça · <strong>{formatarReais(preco.subtotalCentavos)}</strong>
                </>
              )}
            </p>
            {cobrado && produto && pecas > 0 && proximaFaixa(produto.faixas, pecas) && (
              <p className="aviso">
                Com {proximaFaixa(produto.faixas, pecas)!.aPartirDe} peças ou mais deste produto, o preço cai para{' '}
                {formatarReais(proximaFaixa(produto.faixas, pecas)!.centavos)} por peça.
              </p>
            )}
          </section>
        );
      })}
      <p className="mudo">
        Total do pedido: {total} peças{cobrado ? ` · ${formatarReais(totalDoRascunho(r, catalogo))}` : ''}.
      </p>
    </>
  );
}

function PassoProducao({ r, mudar }: Passo) {
  const comPatch = r.itens.some((i) => i.adicionais.patch);
  const comPunhoAdicional = r.itens.some((i) => i.adicionais.punho);
  const rota = SETORES.filter((s) => s !== 'Bordado' || bordadoEfetivo(r));

  return (
    <>
      <h2>3. Produção</h2>
      <fieldset>
        <legend>Prioridade</legend>
        <Opcoes nome="prioridade" valor={r.prioridade} opcoes={PRIORIDADES} aoMudar={(prioridade) => mudar({ prioridade })} />
      </fieldset>

      <label htmlFor="entrega">Data de entrega</label>
      <input id="entrega" type="date" min={diaEmFortaleza()} value={r.dataEntrega} onChange={(e) => mudar({ dataEntrega: e.target.value })} />

      <fieldset>
        <legend>Bordado</legend>
        <Opcoes
          nome="bordado"
          valor={bordadoEfetivo(r) ? 'Sim' : 'Não'}
          opcoes={['Não', 'Sim'] as const}
          desativadas={comPatch ? ['Não'] : []}
          aoMudar={(v) => mudar({ bordado: v === 'Sim' })}
        />
        {comPatch && <p className="mudo">Há produto com patch, então o pedido passa pelo Bordado.</p>}
      </fieldset>

      <label htmlFor="punho">Punho</label>
      <select id="punho" value={r.punho} onChange={(e) => mudar({ punho: e.target.value })}>
        {PUNHOS.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {comPunhoAdicional && r.punho === 'Sem punho' && <p className="aviso">Há produto com o adicional punho: escolha o tipo de punho.</p>}

      <label htmlFor="detalhes">Detalhes</label>
      <textarea id="detalhes" rows={3} value={r.detalhes} onChange={(e) => mudar({ detalhes: e.target.value })} placeholder="Escudo, nomes, números, patrocinador…" />

      <SeletorDeFotos r={r} mudar={mudar} />

      <p className="mudo">
        <strong>Rota:</strong> {rota.join(' → ')} → {r.tipo === 'Cliente' ? 'Financeiro e entrega → Concluído' : 'Concluído'}
      </p>
    </>
  );
}

function PassoRevisao({ r, mudar, catalogo }: Passo & { catalogo: ProdutoDoCatalogo[] }) {
  const [previa, setPrevia] = useState(false);
  const total = r.itens.reduce((s, i) => s + pecasDoItem(i), 0);
  const valor = totalDoRascunho(r, catalogo);
  const entrada = reais(r.entradaValor);
  const comEntrada = r.entradaValor.trim() !== '';
  return (
    <>
      <h2>4. Revisão</h2>
      <dl className="specs">
        <div className="largo">
          <dt>{r.tipo === 'Feira' ? 'Feira' : 'Cliente'}</dt>
          <dd>{r.tipo === 'Feira' ? r.descricao : r.novoCliente ? `${r.nc.nome} (novo)` : r.cliente?.nome}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>{r.prioridade}</dd>
        </div>
        <div>
          <dt>Entrega</dt>
          <dd>{dataBR(r.dataEntrega)}</dd>
        </div>
        <div>
          <dt>Bordado</dt>
          <dd>{bordadoEfetivo(r) ? 'Sim' : 'Não'}</dd>
        </div>
        <div>
          <dt>Punho</dt>
          <dd>{r.punho}</dd>
        </div>
        {r.detalhes.trim() && (
          <div className="largo">
            <dt>Detalhes</dt>
            <dd>{r.detalhes}</dd>
          </div>
        )}
        <div>
          <dt>Fotos</dt>
          <dd>{r.fotos.length === 0 ? 'Nenhuma' : r.fotos.length}</dd>
        </div>
      </dl>
      <h3>Produtos · {total} peças</h3>
      <ul className="resumo">
        {r.itens.map((i, k) => (
          <li key={k}>
            <strong>
              {pecasDoItem(i)}× {tituloDoProduto(i.produto)}
              {r.tipo === 'Cliente' && <> · {formatarReais(precoDoItem(i, catalogo)?.subtotalCentavos ?? 0)}</>}
            </strong>
            <span className="mudo">
              {TAMANHOS[i.modo].filter((t) => Number(i.grade[t]) > 0).map((t) => `${t} ${i.grade[t]}`).join(' · ')}
              {nomesDosAdicionais(i.adicionais).map((a) => ` · + ${a}`)}
            </span>
          </li>
        ))}
      </ul>

      {r.tipo === 'Cliente' && (
        <>
          <h3>Valor e entrada</h3>
          <dl className="specs">
            <div>
              <dt>Valor total</dt>
              <dd>{formatarReais(valor)}</dd>
            </div>
            <div>
              <dt>Calculado pelo catálogo</dt>
              <dd>{total} peças</dd>
            </div>
          </dl>
          <button className="sec" type="button" onClick={() => setPrevia(true)}>
            Ver prévia do orçamento
          </button>

          <label htmlFor="entrada">Entrada recebida (R$)</label>
          <input id="entrada" inputMode="decimal" value={r.entradaValor} onChange={(e) => mudar({ entradaValor: e.target.value })} placeholder="Deixe vazio se não houve entrada" autoComplete="off" />
          {valor > 0 && (
            <p className="mudo">
              Sugestão: 50% do total, {formatarReais(entradaSugeridaCentavos(valor))}.{' '}
              <button className="sec" type="button" onClick={() => mudar({ entradaValor: (entradaSugeridaCentavos(valor) / 100).toFixed(2).replace('.', ',') })}>
                Usar a sugestão
              </button>
            </p>
          )}

          {comEntrada && (
            <>
              <label htmlFor="entrada-forma">Forma de pagamento da entrada</label>
              <select id="entrada-forma" value={r.entradaForma} onChange={(e) => mudar({ entradaForma: e.target.value })}>
                <option value="">Escolha a forma</option>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <label htmlFor="entrada-comprovante">Comprovante da entrada (imagem ou PDF)</label>
              <input id="entrada-comprovante" type="file" accept="image/*,application/pdf" onChange={(e) => mudar({ comprovante: e.target.files?.[0] ?? null })} />
              {Number.isFinite(entrada) && valor > 0 && entrada > 0 && entrada <= valor && (
                <p className="mudo">Saldo a receber depois da entrada: {formatarReais(valor - entrada)}.</p>
              )}
            </>
          )}

          {previa && (
            <Janela titulo="Prévia do orçamento" aoFechar={() => setPrevia(false)} largura="larga">
              <FolhaDoOrcamento dados={orcamentoDoRascunho(r, catalogo)} previa />
              <div className="acoes">
                <button className="sec" onClick={() => setPrevia(false)}>
                  Fechar
                </button>
              </div>
            </Janela>
          )}
        </>
      )}
    </>
  );
}

/** RF-11: fotos de referência (opcionais). Cada uma é reduzida no aparelho antes de entrar na lista. */
function SeletorDeFotos({ r, mudar }: Passo) {
  const seletor = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(false);

  async function adicionar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro('');
    setLendo(true);
    const novas: FotoRascunho[] = [];
    try {
      for (const arquivo of Array.from(arquivos).slice(0, FOTOS_POR_PEDIDO - r.fotos.length)) {
        const imagem = await prepararFoto(arquivo);
        novas.push({ nome: arquivo.name, imagem, previa: URL.createObjectURL(imagem) });
      }
      if (arquivos.length > FOTOS_POR_PEDIDO - r.fotos.length) setErro(`Cada pedido aceita até ${FOTOS_POR_PEDIDO} fotos.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a foto.');
    }
    setLendo(false);
    if (novas.length) mudar({ fotos: [...r.fotos, ...novas] });
  }

  return (
    <>
      <h3>Fotos de referência (opcional)</h3>
      <div className="fotos-rascunho">
        {r.fotos.map((f, i) => (
          <div key={f.previa} className="foto-rascunho">
            <span className="foto">
              <img src={f.previa} alt={f.nome} />
            </span>
            <button
              type="button"
              aria-label={`Remover a foto ${f.nome}`}
              onClick={() => {
                URL.revokeObjectURL(f.previa);
                mudar({ fotos: r.fotos.filter((_, k) => k !== i) });
              }}
            >
              Remover
            </button>
          </div>
        ))}
      </div>
      <input ref={seletor} type="file" accept="image/*" multiple hidden onChange={(e) => { void adicionar(e.target.files); e.target.value = ''; }} />
      {r.fotos.length < FOTOS_POR_PEDIDO && (
        <button className="sec" type="button" disabled={lendo} onClick={() => seletor.current?.click()}>
          {lendo ? 'Preparando…' : 'Adicionar fotos'}
        </button>
      )}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}
