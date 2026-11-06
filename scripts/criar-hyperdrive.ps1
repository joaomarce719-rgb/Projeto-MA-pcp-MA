# Cria o Hyperdrive "pcp-ma" na Cloudflare apontando para o Supabase (Session pooler, São Paulo).
# Antes, defina a senha do banco no Supabase (Database > Settings > Reset database password).
# Aqui a senha é digitada duas vezes, sem eco, e não é gravada em nenhum arquivo.
# Rode na pasta apps/api:  powershell -File ..\..\scripts\criar-hyperdrive.ps1
# Cache desligado de propósito: a fila de produção tem que refletir cada conclusão na hora.

function Ler-Senha($pergunta) {
  $segura = Read-Host $pergunta -AsSecureString
  $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
}

$senha = Ler-Senha 'Senha do banco do Supabase (nao aparece ao digitar)'
if ($senha -ne (Ler-Senha 'Digite a mesma senha de novo')) {
  Write-Host 'As senhas nao sao iguais. Rode o script de novo.'
  exit 1
}

npx wrangler hyperdrive create pcp-ma `
  --host aws-1-sa-east-1.pooler.supabase.com --port 5432 `
  --database postgres --user postgres.tddwcteekakmovczhthh --password $senha `
  --caching-disabled --origin-connection-limit 5

Remove-Variable senha
