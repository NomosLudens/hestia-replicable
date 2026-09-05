# Códice API

A API do Códice é uma extensão de leitura (read-only) embutida na Héstia que visa expor a biblioteca do `/KALINE/codice` de forma segura e determinística para o aplicativo Códice, especialmente através do Tailscale.

## Endpoints

As requisições públicas `GET` e `HEAD` exigem Host válido, `Origin` exata, Bearer Supabase válido e `user.id` presente na allowlist explícita da Station. O Auth server é consultado com uma chave `sb_publishable_`; chaves secret/service-role e JWTs legados de API não são aceitos como configuração.

As requisições `OPTIONS` validam somente o preflight CORS, não exigem Bearer e não consultam o Supabase.

### 1. `GET /api/codice/health`

Retorna o status da biblioteca.

- **Sucesso (200)**: `{"ok":true,"schemaVersion":1,"generatedAt":"...","libraryAvailable":true,"formats":["epub","pdf","txt"]}`
- **Falha (503)**: Retorna se a biblioteca principal (`codice/epub` ou `codice/pdf`) não estiver montada no sistema de arquivos local.

### 2. `GET /api/codice/library`

Varre e indexa a biblioteca em tempo real.

- **Retorno (200)**: Array de livros com metadata, sem expor paths absolutos ou caminhos de diretório.
- **Formato**:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-12T00:00:00.000Z",
  "books": [
    {
      "id": "base64url-sha256-hash",
      "name": "Livro.epub",
      "title": "Livro",
      "author": null,
      "format": "epub",
      "size": 123456,
      "modifiedAt": "2026-07-12T00:00:00.000Z",
      "url": "/api/codice/books/base64url-sha256-hash"
    }
  ]
}
```

### 3. `GET /api/codice/books/:bookId`

Lê e transfere o livro (Stream).

- **Validação**: Verifica se o hash de `bookId` confere com o arquivo listado na indexação e resolve o Path usando `realpath` rígido.
- **Resposta**: Mime-Type definido com base na extensão e arquivo anexado no corpo da resposta com `Content-Disposition`.

### 4. `HEAD /api/codice/books/:bookId`

Verifica a presença e o tamanho do livro sem baixá-lo.

## Segurança

- Não expõe árvores de diretórios (ignora sub-pastas vazias e caminhos complexos).
- CORS aceita somente `HESTIA_CODICE_CORS_ORIGIN`, sem wildcard ou credentials.
- Respostas privadas usam `Cache-Control: private, no-store` e `Vary: Origin`.
- `OPTIONS` valida CORS sem exigir ou consultar um usuário Supabase.
- `GET /api/station/codice/health` é uma rota interna de monitoramento protegida exclusivamente pelo token da Station. Console e Doctor usam essa rota; ela não expõe library nem books.
- Nega qualquer tentativa de symlink fora dos domínios da pasta canônica `/KALINE/codice`.
- Entrega somente arquivos completos. Não anuncia nem implementa Range, `206 Partial Content`, upload, import ou escrita.

Esta API autenticada não deve ser implantada antes de o cliente Kódice enviar o Bearer Supabase. A implantação precisa ser coordenada entre Station e cliente.
