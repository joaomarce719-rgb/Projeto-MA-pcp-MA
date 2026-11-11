import {
  SENHA_MINIMA,
  SETORES,
  edicaoUsuarioBody,
  gerenciaUsuarios,
  papeis,
  podeEditarUsuario,
  usuarioBody,
  type AlteracaoUsuario,
  type Papel,
  type UsuarioLinha,
} from '@pcp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErroApi, api } from '../api';
import { Janela } from '../components/Janela';
import { useEu } from '../eu';
import { quando } from '../formatar';

const NOME_DO_PAPEL: Record<Papel, string> = {
  atendimento: 'Atendimento',
  setor: 'Setor',
  direcao: 'Direção',
  admin: 'Administrador',
};

const mensagemDe = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** RF-04: o Administrador cria, ativa, desativa e redefine a senha de cada pessoa. */
export function Usuarios() {
  const eu = useEu();
  if (eu.isPending) return <p className="mudo">Carregando…</p>;
  if (eu.isError) return <p className="erro" role="alert">{mensagemDe(eu.error, 'Não foi possível carregar seu perfil.')}</p>;
  if (!gerenciaUsuarios(eu.data)) {
    return <div className="cartao vazio">Esta área não faz parte do seu perfil. Só o Administrador gerencia usuários.</div>;
  }
  return <Painel meuId={eu.data.id} />;
}

function Painel({ meuId }: { meuId: string }) {
  const cache = useQueryClient();
  const lista = useQuery({ queryKey: ['usuarios'], queryFn: api.usuarios });
  const [trocando, setTrocando] = useState<UsuarioLinha | null>(null);
  const [editando, setEditando] = useState<UsuarioLinha | null>(null);
  const [vendoAlteracoes, setVendoAlteracoes] = useState<UsuarioLinha | null>(null);
  const [erro, setErro] = useState('');

  const ativar = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => api.mudarAtivo(id, ativo),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível alterar o acesso.')),
  });

  const precos = useMutation({
    mutationFn: ({ id, gerenciaPrecos }: { id: string; gerenciaPrecos: boolean }) => api.mudarGerenciaPrecos(id, gerenciaPrecos),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível alterar a permissão.')),
  });

  if (lista.isError) return <p className="erro" role="alert">{mensagemDe(lista.error, 'Não foi possível carregar os usuários.')}</p>;
  if (!lista.isSuccess) return <p className="mudo">Carregando…</p>;
  const usuarios = lista.data.usuarios;

  return (
    <>
      <h1>Usuários</h1>
      <p className="mudo">
        {plural(usuarios.filter((u) => u.ativo).length, 'ativo', 'ativos')} ·{' '}
        {plural(usuarios.filter((u) => !u.ativo).length, 'desativado', 'desativados')}. Desativar tira o acesso na hora e
        mantém o histórico de quem fez cada etapa.
      </p>

      <NovoUsuario />

      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="lista">
        {usuarios.map((u) => (
          <article key={u.id} className={`cartao usuario${u.ativo ? '' : ' desativado'}`}>
            <div className="linha">
              <strong>{u.nome}</strong>
              <span className="selo">{NOME_DO_PAPEL[u.papel]}{u.setor ? ` · ${u.setor}` : ''}</span>
              {!u.ativo && <span className="selo urgente">Desativado</span>}
              {u.papel === 'atendimento' && u.gerenciaPrecos && <span className="selo">Gerencia preços</span>}
              {u.id === meuId && <span className="selo">Você</span>}
            </div>
            <p className="mudo">{u.email ?? 'sem e-mail cadastrado'}</p>
            <div className="acoes-do-cartao esquerda">
              <button className="sec" onClick={() => setEditando(u)}>Editar</button>
              <button className="sec" onClick={() => setVendoAlteracoes(u)}>Alterações</button>
              <button className="sec" onClick={() => setTrocando(u)}>Trocar senha</button>
              {u.papel === 'atendimento' && (
                <button
                  className="sec"
                  disabled={precos.isPending}
                  onClick={() => { setErro(''); precos.mutate({ id: u.id, gerenciaPrecos: !u.gerenciaPrecos }); }}
                >
                  {u.gerenciaPrecos ? 'Tirar permissão de preços' : 'Permitir gerenciar preços'}
                </button>
              )}
              {u.id !== meuId && (
                <button
                  className={u.ativo ? 'perigo-sec' : 'sec'}
                  disabled={ativar.isPending}
                  onClick={() => { setErro(''); ativar.mutate({ id: u.id, ativo: !u.ativo }); }}
                >
                  {u.ativo ? 'Desativar' : 'Reativar'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {trocando && <TrocarSenha usuario={trocando} aoFechar={() => setTrocando(null)} />}
      {editando && <EditarUsuario usuario={editando} meuId={meuId} aoFechar={() => setEditando(null)} />}
      {vendoAlteracoes && <Alteracoes usuario={vendoAlteracoes} aoFechar={() => setVendoAlteracoes(null)} />}
    </>
  );
}

const NOME_DO_CAMPO: Record<string, string> = { nome: 'Nome', papel: 'Perfil', setor: 'Setor', gerenciaPrecos: 'Gerencia preços' };

function valorLegivel(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '(nenhum)';
  if (campo === 'papel') return NOME_DO_PAPEL[valor as Papel] ?? String(valor);
  if (campo === 'gerenciaPrecos') return valor ? 'sim' : 'não';
  return String(valor);
}

/** RF-04: quem mudou o quê neste usuário, a mais recente primeiro. */
function Alteracoes({ usuario, aoFechar }: { usuario: UsuarioLinha; aoFechar: () => void }) {
  const lista = useQuery({ queryKey: ['alteracoes', usuario.id], queryFn: () => api.alteracoesUsuario(usuario.id) });
  const linhas = (a: AlteracaoUsuario) =>
    Object.keys(a.depois).map((campo) => (
      <li key={campo}>
        {NOME_DO_CAMPO[campo] ?? campo}: {valorLegivel(campo, a.antes[campo as keyof typeof a.antes])} →{' '}
        {valorLegivel(campo, a.depois[campo as keyof typeof a.depois])}
      </li>
    ));

  return (
    <Janela titulo={`Alterações de ${usuario.nome}`} aoFechar={aoFechar}>
      <h2>Alterações</h2>
      <p className="mudo">{usuario.nome}</p>
      {lista.isError && <p className="erro" role="alert">{mensagemDe(lista.error, 'Não foi possível carregar as alterações.')}</p>}
      {lista.isPending && <p className="mudo">Carregando…</p>}
      {lista.isSuccess && lista.data.alteracoes.length === 0 && <p>Nenhuma alteração.</p>}
      {lista.isSuccess && lista.data.alteracoes.length > 0 && (
        <ol className="lista">
          {lista.data.alteracoes.map((a) => (
            <li key={a.id}>
              <p className="mudo">{quando(a.criadoEm)} · por {a.alteradoPor}</p>
              <ul>{linhas(a)}</ul>
            </li>
          ))}
        </ol>
      )}
      <div className="acoes"><button className="pri" onClick={aoFechar}>Fechar</button></div>
    </Janela>
  );
}

/** RF-04: muda nome, papel e setor. A mudança vale na próxima tela que a pessoa abrir e fica no registro de alterações. */
function EditarUsuario({ usuario, meuId, aoFechar }: { usuario: UsuarioLinha; meuId: string; aoFechar: () => void }) {
  const cache = useQueryClient();
  const [f, setF] = useState({ nome: usuario.nome, papel: usuario.papel, setor: usuario.setor ?? '' });
  const [erro, setErro] = useState('');
  const corpo = () => ({ ...f, setor: f.papel === 'setor' ? f.setor || undefined : undefined });
  const travado = usuario.id === meuId;

  const salvar = useMutation({
    mutationFn: () => api.editarUsuario(usuario.id, edicaoUsuarioBody.parse(corpo())),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['usuarios'] });
      await cache.invalidateQueries({ queryKey: ['alteracoes', usuario.id] });
      aoFechar();
    },
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível salvar.')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const lido = edicaoUsuarioBody.safeParse(corpo());
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira os dados.');
    setErro('');
    salvar.mutate();
  }

  return (
    <Janela titulo={`Editar ${usuario.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <h2>Editar usuário</h2>
        <p className="mudo">{usuario.email ?? 'sem e-mail cadastrado'}</p>
        <label htmlFor="e-nome">Nome</label>
        <input id="e-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="off" />
        <label htmlFor="e-papel">Perfil</label>
        <select
          id="e-papel"
          value={f.papel}
          onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}
          aria-describedby={travado ? 'e-papel-ajuda' : undefined}
        >
          {papeis.map((p) => (
            <option key={p} value={p} disabled={!podeEditarUsuario(meuId, usuario.id, p)}>{NOME_DO_PAPEL[p]}</option>
          ))}
        </select>
        {travado && (
          <p id="e-papel-ajuda" className="mudo">Você não pode tirar de si o papel de Administrador.</p>
        )}
        {f.papel === 'setor' && (
          <>
            <label htmlFor="e-setor">Setor</label>
            <select id="e-setor" value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}>
              <option value="">Escolha o setor</option>
              {SETORES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
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

function NovoUsuario() {
  const cache = useQueryClient();
  const vazio = { nome: '', email: '', senha: '', papel: 'atendimento' as Papel, setor: '' };
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState(vazio);
  const [erro, setErro] = useState('');
  const [criado, setCriado] = useState('');

  const criar = useMutation({
    mutationFn: () => api.criarUsuario(usuarioBody.parse({ ...f, setor: f.papel === 'setor' ? f.setor : undefined })),
    onSuccess: async () => {
      setCriado(`Acesso criado para ${f.nome.trim()}. Passe a senha à pessoa e peça para ela entrar.`);
      setF(vazio);
      setAberto(false);
      await cache.invalidateQueries({ queryKey: ['usuarios'] });
    },
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível criar o usuário.')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setCriado('');
    const lido = usuarioBody.safeParse({ ...f, setor: f.papel === 'setor' ? f.setor || undefined : undefined });
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira os dados.');
    setErro('');
    criar.mutate();
  }

  if (!aberto) {
    return (
      <>
        {criado && <p className="aviso" role="status">{criado}</p>}
        <button className="pri" onClick={() => setAberto(true)}>Novo usuário</button>
      </>
    );
  }

  return (
    <form className="cartao" onSubmit={enviar}>
      <h2>Novo usuário</h2>
      <label htmlFor="u-nome">Nome</label>
      <input id="u-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="off" />
      <label htmlFor="u-email">E-mail de acesso</label>
      <input id="u-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
      <label htmlFor="u-senha">Senha inicial (mínimo {SENHA_MINIMA} caracteres)</label>
      <input id="u-senha" type="text" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete="off" />
      <label htmlFor="u-papel">Perfil</label>
      <select id="u-papel" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
        {papeis.map((p) => (
          <option key={p} value={p}>{NOME_DO_PAPEL[p]}</option>
        ))}
      </select>
      {f.papel === 'setor' && (
        <>
          <label htmlFor="u-setor">Setor</label>
          <select id="u-setor" value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}>
            <option value="">Escolha o setor</option>
            {SETORES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes">
        <button type="button" className="sec" onClick={() => { setAberto(false); setErro(''); }}>Cancelar</button>
        <button className="pri" disabled={criar.isPending}>{criar.isPending ? 'Criando…' : 'Criar usuário'}</button>
      </div>
    </form>
  );
}

function TrocarSenha({ usuario, aoFechar }: { usuario: UsuarioLinha; aoFechar: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState(false);

  const trocar = useMutation({
    mutationFn: () => api.trocarSenha(usuario.id, senha),
    onSuccess: () => setFeito(true),
    onError: (e) => setErro(mensagemDe(e, 'Não foi possível trocar a senha.')),
  });

  return (
    <Janela titulo={`Trocar a senha de ${usuario.nome}`} aoFechar={aoFechar}>
      <h2>Trocar a senha</h2>
      <p className="mudo">{usuario.nome}</p>
      {feito ? (
        <>
          <p>Senha trocada. Passe a nova senha à pessoa; as sessões já abertas continuam valendo até expirarem.</p>
          <div className="acoes"><button className="pri" onClick={aoFechar}>Fechar</button></div>
        </>
      ) : (
        <>
          <label htmlFor="nova-senha">Nova senha (mínimo {SENHA_MINIMA} caracteres)</label>
          <input id="nova-senha" type="text" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes">
            <button className="sec" onClick={aoFechar}>Cancelar</button>
            <button
              className="pri"
              disabled={trocar.isPending}
              onClick={() => {
                if (senha.length < SENHA_MINIMA) return setErro(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
                setErro('');
                trocar.mutate();
              }}
            >
              {trocar.isPending ? 'Trocando…' : 'Trocar senha'}
            </button>
          </div>
        </>
      )}
    </Janela>
  );
}
