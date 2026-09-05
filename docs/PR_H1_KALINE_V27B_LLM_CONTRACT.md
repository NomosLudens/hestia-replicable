# PR H1 — Kaline V27b API Contract & CORS Bridge

## Objetivo

Implementar na Héstia o contrato mínimo de runtime local esperado pela Kaline V27b.

## Endpoints

- `GET /api/llm/health`
- `POST /api/llm/chat`

## Segurança

- Héstia continua local-first.
- CORS para Kaline é opt-in via `HESTIA_KALINE_CORS_ORIGIN`.
- Não há wildcard CORS.
- Não há execução de shell vinda do cliente.
- Modelo LLM é validado por allowlist.
- Ollama roda apenas localmente.

## Fora de escopo

- Códice.
- RAG.
- Presence.
- Worker API.
- Supabase.
- Cloud providers.
