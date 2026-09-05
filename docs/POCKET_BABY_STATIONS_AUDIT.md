# Auditoria — Pocket e Baby Stations

## Base

- Branch: work (remote origin ausente; branch local criada `feat/pocket-baby-stations`).
- SHA inicial: 75bfa9e18f51f9cd4029bc9fe17135dd70c9ac58.
- Estado da árvore: limpa antes da implementação.
- Estado do PromptForge: presente no main local em `chama/llm.js` e docs; fora do escopo.
- Versão mínima do Node: `>=22.13.0` em `package.json`.

## Registro atual

- Definição de `STATION_IDS`: `desktop`, `tvbox`, `pocket`, `baby` em `chama/stationClient.js`.
- Mapeamento de variáveis: `HESTIA_DESKTOP_*`, `HESTIA_TVBOX_*`, `HESTIA_POCKET_*` e `HESTIA_BABY_*` em `chama/stationClient.js`.
- Cliente Station: fetch server-side com Bearer, timeout, redirect manual, request id, limite e contratos em `chama/stationClient.js`.
- Rotas genéricas: registradas a partir de `STATION_IDS` em `chama/stationRoutes.js`.
- Rotas especiais: Códice apenas TV Box; Organizer apenas desktop em `chama/stationRoutes.js`.
- Tipos frontend: `StationId = "desktop" | "tvbox" | "pocket" | "baby"` em `src/lib/hestia/api.ts`.
- Cards atuais: quatro cards a partir do registro de Stations em `src/routes/_station.index.tsx`.
- Configuração pública: flags desktop, tvbox, pocket e baby em `publicStationConfig()`.
- Env example: variáveis documentadas em README/deploy, sem env example dedicado.
- Doctor: genérico para Agent em `chama/stationDoctor.js`.
- Smoke: dois Agents efêmeros em `scripts/station-smoke.mjs`.
- Testes: cobrem cliente, Agent, rotas e installer.

## Contrato atual

- Health: `GET /api/station/health`.
- Storage: `GET /api/station/storage/status` para `/KALINE` agregado.
- Services: `GET /api/station/services/status` via allowlist.
- Autenticação: Bearer token com comparação timing-safe.
- Host Guard: valida Host antes da autenticação.
- Timeout: AbortController no cliente.
- Limite de resposta: JSON limitado no cliente.
- Tratamento de offline: estados sanitizados `not_configured`, `misconfigured`, `unavailable`, `unauthorized`, `incompatible`.

## Lacunas

- Nenhuma lacuna nova foi aberta por esta correção do Console Doctor.

## Escopo desta correção

- Reusar o registro canônico das quatro Stations no Console Doctor.
- Separar aviso operacional de falha fatal sem alterar arquitetura, UI, contratos das Stations, PromptForge, LLM, Organizer, Códice, Supabase ou VMs.
- Registrar apenas a validação física comprovada e manter pendências sem inventar conclusão.

# Validação física — 2026-07-19

## Console

- Serviço `hestia-console.service` confirmado como enabled/active.
- Endereço local confirmado em `127.0.0.1:4517`.
- Node confirmado como v24.18.0.
- Frontend confirmado como construído.
- Quatro cards visíveis confirmados.
- Pocket configurada na Console.
- Baby configurada na Console.

## Pocket

- Ubuntu 24.04.4 LTS.
- Arquitetura x86_64.
- Tailscale enabled/active.
- Station Agent enabled/active.
- Agent com bind local em `127.0.0.1:4518`.
- Exposição privada via Tailscale Serve, sem registrar hostname real; use `<POCKET_TS_HOST_REDACTED>`.
- Console reconheceu a Station.
- Métricas reais disponíveis.
- Serviços configurados: `tailscaled`, `hermes`.
- `hermes` pode aparecer como `not-installed` sem invalidar o Agent.

## Baby

- Ubuntu 24.04.4 LTS.
- Arquitetura x86_64.
- Tailscale enabled/active.
- Station Agent enabled/active.
- Agent com bind local em `127.0.0.1:4518`.
- Exposição privada via Tailscale Serve, sem registrar hostname real; use `<BABY_TS_HOST_REDACTED>`.
- Console reconheceu a Station.
- Métricas reais disponíveis.
- Serviços configurados: `tailscaled`, `telegram-guard`.
- `telegram-guard` pode aparecer como `not-installed` sem invalidar o Agent.

## PENDENTE DE GATE FÍSICO

- Queda manual independente do Agent.
- Recuperação após queda.
- Reboot completo da Pocket.
- Reboot completo da Baby.
- Inspeção final de DevTools.
- Ausência de segredos no navegador.
- Hermes funcional.
- Telegram Guard funcional.
- Wake-on-LAN funcional.
