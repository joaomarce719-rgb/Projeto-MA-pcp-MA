import {
  FOTOS_POR_PEDIDO,
  TAMANHOS,
  formatarReais,
  semaforoDoPrazo,
  tituloDoProduto,
  veValores,
  type EventoHistorico,
  type FichaLote,
  type ItemFicha,
  abrePedidos,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ErroApi, api } from '../api';
import { useEu } from '../eu';
import { dataBR, quando } from '../formatar';
import { prepararFoto } from '../imagem';
import { FotoPrivada } from './FotoPrivada';
import { Janela } from './Janela';

const ROTULO_DO_EVENTO: Record<EventoHistorico['tipo'], string> = {
  Cadastro: 'abriu o pedido',
  Conclusão: 'concluiu',
  Recuperação: 'devolveu ao Design',
  Finalização: 'finalizou',
};

function tituloDoEvento(e: EventoHistorico): string {
  const partes = [`${e.etapa} ${ROTULO_DO_EVENTO[e.tipo]}`];
  if (e.maquina) partes.push(`máquina ${e.maquina}`);
  if (e.pecas != null) partes.push(`${e.pecas} peças`);
  return partes.join(' · ');
}

function adicionaisDe(item: ItemFicha): string[] {
  const nomes: string[] = [];
  if (item.adicionais.patch) nomes.push('Patch');
  if (item.adicionais.punho) nomes.push('Punho');
  if (item.adicionais.golaV) nomes.push('Gola V');
  return nomes;
}

/** RF-08, RF-20 e RF-33: ficha do pedido. Mostra o que o servidor mandou; o setor não recebe dados do cliente. */
export function Ficha({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const ficha = useQuery({ queryKey: ['ficha', id], queryFn: () => api.ficha(id) });

  return (
    <Janela titulo="Ficha do pedido" aoFechar={aoFechar} largura="larga">
      <div className="janela-topo">
        <h2>{ficha.data ? `#${ficha.data.numero} · ${ficha.data.descricao}` : 'Ficha do pedido'}</h2>
        <button className="sec" onClick={aoFechar} aria-label="Fechar a ficha">
          Fechar
        </button>
      </div>
      {ficha.isPending && <p className="mudo">Carregando…</p>}
      {ficha.isError && (
        <p className="erro" role="alert">
          {ficha.error instanceof ErroApi ? ficha.error.message : 'Não foi possível abrir a ficha.'}
        </p>
      )}
      {ficha.isSuccess && <Conteudo ficha={ficha.data} />}
    </Janela>
  );
}

function Conteudo({ ficha }: { ficha: FichaLote }) {
  const eu = useEu();
  // A Direção só acompanha: a linha do tempo (onde o pedido está e o que já foi feito) vem primeiro.
  const daDirecao = eu.data?.papel === 'direcao';
  const prazo = semaforoDoPrazo(ficha.dataEntrega);
  const motivo = [...ficha.historico].reverse().find((e) => e.tipo === 'Recuperação')?.nota;

  return (
    <>
      <div className="linha">
        <span className={`selo ${ficha.prioridade.toLowerCase()}`}>{ficha.prioridade}</span>
        <span className="selo">{ficha.tipo}</span>
        <span className="selo">{ficha.etapa}</span>
        <span className={`prazo ${prazo.cor}`}>{prazo.texto}</span>
        <span className="mudo">{ficha.quantidade} peças</span>
      </div>

      {ficha.recuperacaoPendente && (
        <div className="banner-rec" role="note">
          <strong>Recuperação · devolvido ao Design</strong>
          {motivo && <p>{motivo}</p>}
        </div>
      )}

      {daDirecao && <LinhaDoTempo ficha={ficha} />}

      <SecaoFotos ficha={ficha} />

      <h3>Produtos</h3>
      {ficha.itens.map((item, i) => {
        const tamanhos = TAMANHOS[item.modo];
        const extras = adicionaisDe(item);
        return (
          <div key={i} className="item-ficha">
            <strong>{tituloDoProduto(item.produto)}</strong>
            <span className="mudo">
              {' '}
              · {item.modo === 'adulto' ? 'Adulto' : 'Infantil'}
              {item.malha && ` · Malha ${tituloDoProduto(item.malha)}`}
              {extras.length > 0 && ` · + ${extras.join(', ')}`}
            </span>
            <div className="rolagem">
              <table className="grade">
                <thead>
                  <tr>
                    {tamanhos.map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {tamanhos.map((t) => (
                      <td key={t} className={item.grade[t] ? '' : 'zero'}>
                        {item.grade[t] ?? 0}
                      </td>
                    ))}
                    <td>
                      <strong>{item.quantidade}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <h3>Produção</h3>
      <dl className="specs">
        <div>
          <dt>Entrega</dt>
          <dd>{dataBR(ficha.dataEntrega)}</dd>
        </div>
        <div>
          <dt>Bordado</dt>
          <dd>{ficha.bordado ? 'Sim' : 'Não'}</dd>
        </div>
        <div>
          <dt>Punho</dt>
          <dd>{ficha.punho}</dd>
        </div>
        <div className="largo">
          <dt>Malha do calção</dt>
          <dd>{ficha.malhaCalcao}</dd>
        </div>
        <div className="largo">
          <dt>Detalhes</dt>
          <dd>{ficha.detalhes || 'Sem detalhes adicionais.'}</dd>
        </div>
      </dl>

      {ficha.cliente && (
        <>
          <h3>Cliente</h3>
          <dl className="specs">
            <div className="largo">
              <dt>Nome</dt>
              <dd>{ficha.cliente.nome}</dd>
            </div>
            {ficha.cliente.documento && (
              <div>
                <dt>CPF/CNPJ</dt>
                <dd>{ficha.cliente.documento}</dd>
              </div>
            )}
            {ficha.cliente.telefone && (
              <div>
                <dt>Telefone</dt>
                <dd>{ficha.cliente.telefone}</dd>
              </div>
            )}
            {ficha.cliente.cidade && (
              <div>
                <dt>Cidade</dt>
                <dd>{ficha.cliente.cidade}</dd>
              </div>
            )}
          </dl>
        </>
      )}

      {ficha.valores && <SecaoValores v={ficha.valores} pedidoId={ficha.id} />}

      {!daDirecao && <LinhaDoTempo ficha={ficha} />}
    </>
  );
}

/** Valores do pedido de Cliente (total, recebido, saldo). O servidor só os manda para atendimento, direção e admin. */
function SecaoValores({ v, pedidoId }: { v: NonNullable<FichaLote['valores']>; pedidoId: string }) {
  const eu = useEu();
  const veOrcamento = eu.data ? veValores(eu.data) : false;
  return (
    <>
      <h3>Valores</h3>
      <dl className="specs">
        <div>
          <dt>Total</dt>
          <dd>{formatarReais(v.totalCentavos)}</dd>
        </div>
        <div>
          <dt>Recebido</dt>
          <dd>{formatarReais(v.recebidoCentavos)}</dd>
        </div>
        <div>
          <dt>Saldo</dt>
          <dd>{formatarReais(v.saldoCentavos)}</dd>
        </div>
        <div>
          <dt>Pago</dt>
          <dd>{v.totalCentavos === 0 ? 'Pedido sem valor cadastrado' : `${v.percentualPago}%`}</dd>
        </div>
      </dl>
      {veOrcamento && (
        <Link to="/orcamento/$pedidoId" params={{ pedidoId }} className="botao sec">
          Ver orçamento
        </Link>
      )}
    </>
  );
}

interface Evento {
  chave: string;
  em: string;
  titulo: string;
  por: string | null;
  nota: string | null;
  classe: string;
}

/** Histórico de produção e recebimentos numa linha só, do mais recente para o mais antigo. */
function eventosDe(ficha: FichaLote): Evento[] {
  const doHistorico: Evento[] = ficha.historico.map((e, i) => ({
    chave: `h${i}`,
    em: e.em,
    titulo: e.etapa === 'Financeiro' && e.tipo === 'Finalização' ? 'Entrega confirmada · pedido concluído' : tituloDoEvento(e),
    por: e.por,
    nota: e.etapa === 'Financeiro' && e.tipo === 'Finalização' ? null : e.nota,
    classe: e.tipo === 'Recuperação' ? 'devolucao' : '',
  }));
  const dosRecebimentos: Evento[] = (ficha.valores?.recebimentos ?? []).map((r) => ({
    chave: `r${r.id}`,
    em: r.em,
    titulo: `${r.momento === 'Entrada' ? 'Entrada' : 'Recebimento'} de ${formatarReais(r.valorCentavos)} · ${r.forma}`,
    por: r.por,
    nota: null,
    classe: 'dinheiro',
  }));
  return [...doHistorico, ...dosRecebimentos].sort((a, b) => b.em.localeCompare(a.em));
}

/** RF-20 e RN-37: quem fez cada coisa, quando e o que informou. */
function LinhaDoTempo({ ficha }: { ficha: FichaLote }) {
  return (
    <>
      <h3>Linha do tempo</h3>
      <ol className="linha-do-tempo">
        {ficha.etapa !== 'Concluído' && (
          <li className="agora">
            <strong>Agora em {ficha.etapa === 'Financeiro' ? 'Financeiro e entrega' : ficha.etapa}</strong>
          </li>
        )}
        {eventosDe(ficha).map((e) => (
          <li key={e.chave} className={e.classe}>
            <strong>{e.titulo}</strong>
            <span className="mudo">
              {e.por ?? '—'} · {quando(e.em)}
            </span>
            {e.nota && <p>{e.nota}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

/** RF-11 e RF-20: fotos de referência. Só atendimento e admin adicionam; quem vê o pedido vê as fotos. */
function SecaoFotos({ ficha }: { ficha: FichaLote }) {
  const eu = useEu();
  const cache = useQueryClient();
  const seletor = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState('');
  const podeAdicionar = !!eu.data && abrePedidos(eu.data) && ficha.fotos.length < FOTOS_POR_PEDIDO;

  const enviar = useMutation({
    mutationFn: async (arquivo: File) => api.enviarFoto(ficha.id, await prepararFoto(arquivo), arquivo.name),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['ficha', ficha.id] }),
    onError: (e) => setErro(e instanceof Error ? e.message : 'Não foi possível enviar a foto.'),
  });

  if (ficha.fotos.length === 0 && !podeAdicionar) return null;
  return (
    <>
      <h3>Fotos de referência</h3>
      <div className="fotos">
        {ficha.fotos.map((f) => (
          <FotoPrivada key={f.id} id={f.id} nome={f.nome} />
        ))}
        {ficha.fotos.length === 0 && <p className="mudo">Nenhuma foto neste pedido.</p>}
      </div>
      {podeAdicionar && (
        <>
          <input
            ref={seletor}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              e.target.value = '';
              setErro('');
              if (arquivo) enviar.mutate(arquivo);
            }}
          />
          <button className="sec" type="button" disabled={enviar.isPending} onClick={() => seletor.current?.click()}>
            {enviar.isPending ? 'Enviando…' : 'Adicionar foto'}
          </button>
        </>
      )}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}
