# Contrato das rotas novas

Mesmo formato das outras rotas de usuários (`docs/TECNOLOGIAS.md`): JSON, login obrigatório, erros `{ "erro": "…" }`.

## POST /usuarios/:id

Edita nome, papel e setor. Só o Administrador.

Corpo (`edicaoUsuarioBody`):

```json
{ "nome": "Maria Souza", "papel": "setor", "setor": "Embalagem" }
```

| Resposta | Quando |
|---|---|
| 200 `{ "ok": true }` | gravado (ou nada mudou) |
| 400 | `id` não é UUID ("Usuário inválido."); corpo inválido ("Informe o nome da pessoa.", "Escolha o setor desta pessoa.", "Só quem é de setor tem setor.") |
| 403 | não é Administrador ("Só o Administrador gerencia usuários.") |
| 404 | usuário não existe ("Usuário não encontrado.") |
| 409 | o Administrador tira de si o papel de Administrador ("Você não pode tirar de si o papel de Administrador.") |

## GET /usuarios/:id/alteracoes

Alterações registradas do usuário, a mais recente primeiro. Só o Administrador.

```json
{
  "alteracoes": [
    {
      "id": "12",
      "criadoEm": "2026-11-09T14:03:00.000Z",
      "alteradoPor": "João (Admin)",
      "antes": { "papel": "setor", "setor": "Costura" },
      "depois": { "papel": "setor", "setor": "Embalagem" }
    }
  ]
}
```

| Resposta | Quando |
|---|---|
| 200 | lista (vazia se nunca editado) |
| 400 | `id` não é UUID |
| 403 | não é Administrador |
| 404 | usuário não existe |
