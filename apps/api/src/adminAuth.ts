/**
 * Criar usuários e trocar senhas é uma ação de administrador do Supabase Auth: exige a chave `service_role`, que só
 * existe como segredo do Worker (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`) e nunca vai para o navegador.
 *
 * Esta camada fica atrás de uma interface para a API poder ser testada sem a conta do Supabase.
 * ATENÇÃO: o cliente de verdade (`adminSupabase`) ainda não foi exercitado contra um projeto Supabase real.
 */
export type MotivoDaRecusa = 'email_existente' | 'senha_fraca';

export interface AdminAuth {
  criar(dados: { email: string; senha: string; nome: string }): Promise<{ ok: true; id: string } | { ok: false; motivo: MotivoDaRecusa }>;
  trocarSenha(id: string, senha: string): Promise<{ ok: true } | { ok: false; motivo: MotivoDaRecusa | 'nao_existe' }>;
  /** Desfaz um usuário criado (usado quando o perfil não pôde ser gravado). Não falha se ele já não existir. */
  apagar(id: string): Promise<void>;
}

interface Resposta {
  status: number;
  json: Record<string, unknown>;
}

/** Entende a recusa do Supabase pelo código ou pelo texto; qualquer outra coisa é erro de verdade, não recusa. */
function motivoDe({ json }: Resposta): MotivoDaRecusa | null {
  const codigo = String(json.error_code ?? json.code ?? '');
  const texto = String(json.msg ?? json.message ?? json.error_description ?? '').toLowerCase();
  if (codigo === 'email_exists' || codigo === 'user_already_exists' || /already (been )?registered|already exists/.test(texto)) {
    return 'email_existente';
  }
  if (codigo === 'weak_password' || /weak password|password (is )?(too )?(short|weak)|at least \d+ characters/.test(texto)) {
    return 'senha_fraca';
  }
  return null;
}

export function adminSupabase(supabaseUrl: string, chave: string | undefined): AdminAuth {
  const base = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;

  async function chamar(metodo: string, caminho = '', corpo?: unknown): Promise<Resposta> {
    if (!chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY não está configurada no Worker.');
    const r = await fetch(`${base}${caminho}`, {
      method: metodo,
      // Chave nova (`sb_secret_…`) não é JWT: vai só em `apikey`. A chave antiga (`service_role`, um JWT) também vai em Authorization.
      headers: {
        apikey: chave,
        ...(chave.startsWith('eyJ') ? { Authorization: `Bearer ${chave}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }

  return {
    async criar({ email, senha, nome }) {
      // email_confirm: sem isso o usuário criado não consegue entrar (o Supabase pede confirmação por e-mail).
      const r = await chamar('POST', '', { email, password: senha, email_confirm: true, user_metadata: { nome } });
      if (r.status >= 200 && r.status < 300 && typeof r.json.id === 'string') return { ok: true, id: r.json.id };
      const motivo = motivoDe(r);
      if (motivo) return { ok: false, motivo };
      throw new Error(`O Supabase Auth recusou a criação do usuário (HTTP ${r.status}).`);
    },

    async trocarSenha(id, senha) {
      const r = await chamar('PUT', `/${id}`, { password: senha });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      if (r.status === 404) return { ok: false, motivo: 'nao_existe' };
      const motivo = motivoDe(r);
      if (motivo) return { ok: false, motivo };
      throw new Error(`O Supabase Auth recusou a troca de senha (HTTP ${r.status}).`);
    },

    async apagar(id) {
      const r = await chamar('DELETE', `/${id}`);
      if (r.status >= 300 && r.status !== 404) throw new Error(`O Supabase Auth recusou apagar o usuário (HTTP ${r.status}).`);
    },
  };
}
