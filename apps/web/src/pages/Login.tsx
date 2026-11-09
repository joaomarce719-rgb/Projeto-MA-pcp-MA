import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { ACESSOS_DEMO, MODO_DEMO, SENHA_DEMO, acessoDoLogin, entrarComoDemo } from '../demo';
import { supabase } from '../supabase';

export function Login() {
  const navegar = useNavigate();
  const cache = useQueryClient();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    // Modo demonstração: o login digitado ("design", "atendimento"…) com a senha de demonstração entra direto.
    const acesso = MODO_DEMO ? acessoDoLogin(email, senha) : null;
    if (acesso) return entrarComoDemo(acesso);
    setEntrando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) {
      setErro('Usuário ou senha incorretos.');
      return;
    }
    // Nada da pessoa anterior (perfil, filas) pode sobrar para quem acabou de entrar neste aparelho.
    cache.clear();
    await navegar({ to: '/' });
  }

  return (
    <div className="login">
      <div className="login-coluna">
        <form className="cartao" onSubmit={entrar}>
          <h1>Entrar</h1>
          <p className="mudo">Use o usuário e a senha do seu setor.</p>
          <label htmlFor="email">{MODO_DEMO ? 'Usuário' : 'Usuário (e-mail)'}</label>
          <input
            id="email"
            type={MODO_DEMO ? 'text' : 'email'}
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
          {erro && (
            <p className="erro" role="alert">
              {erro}
            </p>
          )}
          <button className="pri" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {MODO_DEMO && (
          <section className="demo" aria-labelledby="demo-titulo">
            <h2 id="demo-titulo">Acessos de demonstração</h2>
            <p className="mudo">
              Toque num perfil para entrar. A senha de todos é <strong>{SENHA_DEMO}</strong>. Dados de exemplo: nada aqui vai para o sistema de verdade.
            </p>
            <div className="demo-lista">
              {ACESSOS_DEMO.map((a) => (
                <button key={a.login} type="button" className={`demo-acesso${a.numero ? '' : ' escuro'}`} onClick={() => entrarComoDemo(a)}>
                  <span className="demo-icone">{a.numero ?? a.nome.charAt(0)}</span>
                  <span>
                    <strong>{a.nome}</strong>
                    <small>{a.descricao}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
