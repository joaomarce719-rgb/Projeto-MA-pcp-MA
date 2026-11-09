# Quickstart: validar "Editar usuários"

## Automático (na raiz de `pcp-ma/`)

```bash
npm test -w packages/shared -- usuarios
npm test -w apps/api -- usuarios
npm test
npm run typecheck
npm run build -w apps/web
```

Esperado: tudo verde. Os testes de API cobrem os cenários da [spec](spec.md): 403 para quem não é Administrador,
404, 400 de setor, 409 do próprio papel, `gerencia_precos` zerado ao sair do Atendimento, a linha no registro, nenhuma
linha quando nada muda, e o banco recusando alterar ou apagar o registro.

## Manual (modo demonstração)

1. `npm run dev:local` e, em outro terminal, `npm run dev:demo`.
2. Entrar como Administrador; abrir Usuários.
3. Editar uma pessoa da Costura: setor → Embalagem. Salvar.
4. Entrar como essa pessoa: a fila mostra só a Embalagem.
5. Voltar ao Administrador, abrir "Alterações" da pessoa: uma linha, Costura → Embalagem, com data e quem alterou.
6. Tentar tirar de si o papel de Administrador: a tela mostra a recusa.

## Antes de publicar

Rodar `db/migracoes/006_alteracoes_usuarios.sql` no SQL Editor do Supabase e conferir:

```sql
select to_regclass('public.alteracoes_usuarios') is not null as pode_publicar;
```

Só então publicar a API e, depois, a interface ([contrato](contracts/api.md)).
