# Roda a medição de tempo (scripts/medir.mjs) contra a API publicada.
# A senha do login do administrador é pedida aqui, sem eco, e vale só para este processo.
# Antes: os lotes de db/seed-medicao.sql precisam estar no banco.
# Rode na raiz de pcp-ma:  powershell -File scripts\medir.ps1

$env:SUPABASE_URL = 'https://tddwcteekakmovczhthh.supabase.co'
$env:SUPABASE_ANON_KEY = 'sb_publishable_fc3aZgfMWpgr6KaAPxbfSw_DwudEvgP'
$env:API_URL = 'https://pcp-ma-api.mafardamentos.workers.dev'
$env:MEDIR_EMAIL = 'joaomarce719@gmail.com'

$segura = Read-Host 'Senha do login do administrador (nao aparece ao digitar)' -AsSecureString
$ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try {
  $env:MEDIR_SENHA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro)
  node scripts/medir.mjs
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
  Remove-Item Env:MEDIR_SENHA -ErrorAction SilentlyContinue
}
