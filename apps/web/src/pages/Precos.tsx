import {
  formatarReais,
  lerValorEmCentavos,
  podeGerenciarPrecos,
  produtoBody,
  tituloDoProduto,
  type ProdutoBody,
  type ProdutoDePreco,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErroApi, api } from '../api';
import { Janela } from '../components/Janela';
import { useEu } from '../eu';
import { quando } from '../formatar';

const mensagemDe = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** 3500 → "35,00", para preencher o campo de preço. */
const emReais = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');

/**
 * RN-11: produtos e preços do catálogo. É do Administrador e de quem ele escolheu no Atendimento;
 * a API confere a permissão (esta tela só esconde o que a pessoa não pode usar).
 */
export function Precos() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) return <p className="erro" role="alert">{mensagemDe(eu.error, 'Não foi possível carregar seu perfil.')}</p>;
  if (!podeGerenciarPrecos(eu.data)) {
    return (
      <div className="cartao vazio">
        Esta área não faz parte do seu perfil. Peça ao Administrador a permissão de gerenciar preços.
      </div>
    );
  }
  return <Painel />;
}

function Painel() {
  const lista = useQuery({ queryKey: ['precos'], queryFn: api.precos });
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<ProdutoDePreco | 'novo' | null>(null);
  const [aviso, setAviso] = useState('');

  if (lista.isError) return <p className="erro" role="alert">{mensagemDe(lista.error, 'Não foi possível carregar os preços.')}</p>;
  if (!lista.isSuccess) return <p className="mudo">Carregando…</p>;
  const produtos = lista.data.produtos;
  const palavras = semAcento(busca.trim()).split(/\s+/).filter(Boolean);
  const visiveis = produtos.filter((p) => palavras.every((w) => semAcento(`${p.nome} ${p.malha}`).includes(w)));

  return (
    <>
      <h1>Preços dos produtos</h1>
      <p className="mudo">
        {plural(produtos.filter((p) => p.ativo).length, 'produto ativo', 'produtos ativos')} ·{' '}
        {plural(produtos.filter((p) => !p.ativo).length, 'desativado', 'desativados')}. Preço por peça: a faixa de
        10 peças ou mais e a de menos de 10 valem por produto do pedido. Alterar um preço vale só para os pedidos
        novos; os pedidos já abertos mantêm o preço do dia. Os adicionais (patch, punho e gola V) não mudam aqui.
      </p>

      {aviso && <p className="aviso" role="status">{aviso}</p>}
      <div className="barra-busca">
        <input
          type="search"
          aria-label="Buscar produto"
          placeholder="Buscar produto ou malha"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button className="pri" onClick={() => { setAviso(''); setEditando('novo'); }}>Novo produto</button>
      </div>

      {visiveis.length === 0 ? (
        <div className="cartao vazio">Nenhum produto encontrado.</div>
      ) : (
        <div className="lista">
          {visiveis.map((p) => (
            <article key={p.id} className={`cartao produto${p.ativo ? '' : ' desativado'}`}>
              <div className="linha">
                <strong>{tituloDoProduto(p.nome)}</strong>
                {!p.ativo && <span className="selo urgente">Desativado</span>}
              </div>
              <p className="mudo">Malha: {tituloDoProduto(p.malha)}</p>
              <div className="precos-do-produto">
                <span>
                  <small>10 peças ou mais</small>
                  <strong>{formatarReais(p.maiorCentavos)}</strong>
                </span>
                <span>
                  <small>Menos de 10 peças</small>
                  <strong>{formatarReais(p.menorCentavos)}</strong>
                </span>
              </div>
              <div className="linha">
                <small className="mudo">
                  {p.atualizadoPor ? `Alterado em ${quando(p.atualizadoEm)} por ${p.atualizadoPor}` : `Atualizado em ${quando(p.atualizadoEm)}`}
                </small>
                <button className="sec" onClick={() => { setAviso(''); setEditando(p); }}>Editar</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editando && (
        <FormularioDoProduto
          produto={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={(texto) => { setEditando(null); setAviso(texto); }}
        />
      )}
    </>
  );
}

function FormularioDoProduto({
  produto,
  aoFechar,
  aoSalvar,
}: {
  produto: ProdutoDePreco | null;
  aoFechar: () => void;
  aoSalvar: (aviso: string) => void;
}) {
  const cache = useQueryClient();
  const [f, setF] = useState({
    nome: produto ? tituloDoProduto(produto.nome) : '',
    malha: produto ? tituloDoProduto(produto.malha) : '',
    maior: produto ? emReais(produto.maiorCentavos) : '',
    menor: produto ? emReais(produto.menorCentavos) : '',
    ativo: produto?.ativo ?? true,
  });
  const [erro, setErro] = useState('');

  const salvar = useMutation({
    mutationFn: async (corpo: ProdutoBody) => {
      if (produto) await api.atualizarProduto(produto.id, corpo);
      else await api.criarProduto(corpo);
    },
    onSuccess: async (_r, corpo) => {
      await Promise.all([cache.invalidateQueries({ queryKey: ['precos'] }), cache.invalidateQueries({ queryKey: ['catalogo'] })]);
      aoSalvar(produto ? `Preços de ${tituloDoProduto(corpo.nome)} atualizados.` : `${tituloDoProduto(corpo.nome)} entrou no catálogo.`);
    },
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível salvar o produto.')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const maior = lerValorEmCentavos(f.maior);
    const menor = lerValorEmCentavos(f.menor);
    if (maior === null) return setErro('Informe o preço de 10 peças ou mais, por exemplo 35,00.');
    if (menor === null) return setErro('Informe o preço de menos de 10 peças, por exemplo 42,00.');
    const lido = produtoBody.safeParse({ nome: f.nome, malha: f.malha, maiorCentavos: maior, menorCentavos: menor, ativo: f.ativo });
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira os dados.');
    setErro('');
    salvar.mutate(lido.data);
  }

  return (
    <Janela titulo={produto ? 'Editar produto' : 'Novo produto'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <h2>{produto ? 'Editar produto' : 'Novo produto'}</h2>
        <label htmlFor="p-nome">Nome do produto</label>
        <input id="p-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="off" />
        <small className="mudo">
          Nomes com “infantil” usam a grade infantil (2 a 14); calção, bermuda e calça levam a malha para a ficha.
        </small>
        <label htmlFor="p-malha">Malha</label>
        <input id="p-malha" value={f.malha} onChange={(e) => setF({ ...f, malha: e.target.value })} autoComplete="off" />
        <label htmlFor="p-maior">Preço por peça: 10 peças ou mais (R$)</label>
        <input id="p-maior" inputMode="decimal" placeholder="35,00" value={f.maior} onChange={(e) => setF({ ...f, maior: e.target.value })} autoComplete="off" />
        <label htmlFor="p-menor">Preço por peça: menos de 10 peças (R$)</label>
        <input id="p-menor" inputMode="decimal" placeholder="42,00" value={f.menor} onChange={(e) => setF({ ...f, menor: e.target.value })} autoComplete="off" />
        {produto && (
          <label className="marcar" htmlFor="p-ativo">
            <input id="p-ativo" type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            Produto ativo (aparece no pedido novo)
          </label>
        )}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes">
          <button type="button" className="sec" onClick={aoFechar}>Cancelar</button>
          <button className="pri" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Janela>
  );
}
