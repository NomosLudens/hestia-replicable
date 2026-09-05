# PR H2 — Hermes Inbox/Outbox

## Objetivo

Adicionar à Héstia uma caixa persistente de comandos por arquivos, monitorada e processada localmente a partir de um diretório compartilhado.

## Princípio

- Kaline/agentes locais criam comandos `.json` na Inbox.
- A Héstia valida e processa o comando.
- O resultado é escrito na Outbox como arquivo `*.result.json`.

## Endpoints

- `GET /api/hermes/status`
- `POST /api/hermes/process-once`

## Tipos permitidos

- `station.status`
- `llm.chat`

## Segurança

- Sem watcher infinito.
- Sem execução shell.
- Sem comandos arbitrários.
- Sem path traversal.
- Sem processar fora da Hermes root.
- Confirmação local obrigatória para `process-once`.

## Fora de escopo

- Códice.
- RAG.
- Parser EPUB/PDF.
- Organização real de arquivos.
- Worker.
- Supabase.
- Presence.
