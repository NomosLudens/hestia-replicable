# Héstia — Safety Freeze

Este documento marca o congelamento de segurança da Héstia Station.

## O que a Héstia é

- Station local;
- Console visual;
- Chama Local;
- medição de hardware/storage/services;
- organizer com plano aprovado;
- Hermes Inbox/Outbox;
- ponte local para Ollama;
- endpoints para Klio e Presence.

## O que a Héstia não é

- não é Klio;
- não é Kaline;
- não é Hefaístia;
- não é Kuan-Yin;
- não é chat principal;
- não é executor genérico;
- não é file manager completo;
- não é painel público;
- não é serviço de sync automático.

## Regras congeladas

- loopback por padrão;
- LAN só com opt-in explícito;
- sem `0.0.0.0` por padrão;
- sem Supabase;
- sem OpenRouter;
- sem Syncthing como requisito;
- sem shell pela UI;
- sem upload público;
- sem delete arbitrário;
- organizer só por plano aprovado;
- Hermes só por comandos allowlisted;
- LLM só via Ollama local;
- doctor diagnostica, não repara.

## Rotas sensíveis

Estas rotas não devem ser automatizadas externamente sem confirmação local:

- `POST /api/local/organizer/apply`
- `POST /api/local/organizer/runs/:runId/undo`
- `POST /api/local/organizer/runs/:undoRunId/redo`
- `POST /api/hermes/process-once`

## Próximas features

Novas features devem nascer em Klio/Hefaístia/Kaline, não na Héstia, salvo se forem infraestrutura local real.
