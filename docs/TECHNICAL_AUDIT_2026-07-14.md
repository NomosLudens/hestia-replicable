# Resumo Executivo

Esta auditoria documenta o snapshot do repositório Héstia identificado abaixo. O documento descreve evidências observadas nesse snapshot e não deve ser lido como garantia sobre versões futuras do repositório.

## Identificação da auditoria

- Repositório: `Tonyus-dev/hestia`
- Branch auditada: `main`
- Commit-base auditado: `6bb877241b0ddb76822a39a6f2e1e423f2b5a166`
- Data da auditoria: `2026-07-14`
- Natureza: auditoria estática + execução de testes/build/lint
- Validação manual no host físico: não realizada nesta auditoria

## Metodologia e limites

- Leitura completa dos arquivos versionados relevantes ao runtime e aos contratos auditados: `hestia.js`, módulos `chama/`, cliente HTTP `src/lib/hestia/`, rotas `src/routes/`, componentes Héstia relevantes, `package.json`, configuração Vite/Vitest/TypeScript, scripts, packaging e documentação operacional.
- Verificação por busca e referência cruzada para endpoints, variáveis de ambiente, chamadas frontend→backend, usos de `exec`/`execFile`, testes, dependências e documentação divergente.
- Arquivos gerados, caches e artefatos de build não foram considerados fonte canônica de arquitetura ou contrato. Exemplos: `dist/`, `node_modules/`, caches do tooling e arquivos gerados pelo build.
- Dependências externas foram auditadas apenas pelo uso declarado e pontos de integração no repositório; o código interno de bibliotecas npm, LibreOffice, Ollama, systemd, Samba e Tailscale não foi auditado.
- Não houve validação no servidor físico.
- Não houve prova manual de UI, `/KALINE`, Ollama, LibreOffice, systemd, Samba ou Tailscale.
- Build, lint e testes automatizados não equivalem a produto funcionando. Eles provam apenas que os contratos automatizados executados passaram no ambiente desta auditoria.

## Premissas de implantação

Cenário operacional esperado inferido pela documentação e pelo código:

```txt
Tailscale
├── rede privada criptografada
├── acesso remoto ao servidor
└── fronteira principal de rede
Samba
├── administração de arquivos
└── acesso ao /KALINE
Héstia
├── API local
├── processamento
├── storage
└── integração com Códice
```

Premissas de segurança operacional:

- A Héstia não deve ser exposta diretamente à internet.
- Não deve haver port forwarding público para a Héstia.
- Samba deve ficar restrito à rede local confiável e/ou à interface `tailscale0`.
- Tailscale reduz a superfície de exposição ao retirar a Héstia da internet pública.
- Tailscale não substitui validação de entrada, autorização de operações, confirmação de escrita, idempotência ou proteção contra escrita insegura.
- Dispositivos não confiáveis dentro da tailnet devem ser tratados como parte da superfície de ataque.

## Veredito Produto Real

**INCIDENTE:** não há prova nesta auditoria de que o fluxo principal completo abre e funciona manualmente no host físico real. Existem testes automatizados e documentação de validação anterior, mas build/lint/teste automatizado não provam funcionamento manual. A checagem feita aqui validou leitura estática, contratos, testes e build; não validou a UI em navegador com `/KALINE`, Ollama, LibreOffice, systemd, Samba, Tailscale e disco reais.

## Classificação de evidência

| Tipo | O que foi observado | Limite |
|---|---|---|
| Achado comprovado por código | Rotas, middlewares, allowlists, variáveis de ambiente, persistência em filesystem, chamadas frontend→backend e uso de comandos locais. | Evidência estática; não prova operação real no host físico. |
| Achado comprovado por teste | Suíte Vitest passou após a correção documental; cobre unidades e contratos automatizados existentes. | Não substitui smoke manual nem valida integrações reais com `/KALINE`, Ollama, LibreOffice, systemd, Samba ou Tailscale. |
| Achado não validado no host real | Abertura do app, fluxo Organizer completo, Códice com arquivos reais grandes, LLM com modelo instalado, Station, Samba e Tailscale. | Deve permanecer como incidente até prova manual datada. |
| Risco dependente da implantação | Exposição de rotas de escrita/importação e leitura de presença fora de rede confiável. | Severidade aumenta se a Héstia sair do cenário local/tailnet confiável. |

## Principais achados

| Severidade | Achado | Evidência |
|---|---|---|
| Alta, podendo se tornar Crítica conforme implantação | Endpoint de importação do Códice escreve em disco e executa `soffice` via `exec`, mas não exige confirmação dedicada de operação; a rota é consumida pelo frontend como upload real. | `POST /api/codice/import`, `convertDocxToEpub`, `hestiaLegacyApi.codiceImport` |
| Resolvido | Contrato do Organizer unificado em `/api/local/organizer/*`: plan/apply/undo/redo usam POST com confirmação e runs usam GET. | `registerOrganizerRoutes`; chamadas em `src/lib/hestia/api.ts` |
| Resolvido | README lista o contrato local do Organizer: plan/apply/runs/undo/redo em `/api/local/organizer/*`. | README vs backend |
| Resolvido | Geração de plano migrou para `POST /api/local/organizer/plan` com `X-Hestia-Local-Confirm: organize`; rotas antigas de storage não geram nem persistem planos. | `registerOrganizerRoutes`; `generateOrganizerPlan` + `writePlan` |
| Média | `config.storageSources` existe e é exposto, mas não há mecanismo de configuração populando esse array; portanto fontes externas parecem mortas/inativas no runtime atual. | `config.storageSources: []` e `/api/storage/sources` |
| Média | Station usa configuração sanitizada no frontend e cliente backend robusto, mas é opcional; sem env fica `not_configured`. | `stationClient.js`, `/api/station/*` |
| Média | Códice exige `codice/epub` e `codice/pdf`; se qualquer um faltar, health/library falham com 503, embora `txt` seja opcional. | `getAvailableCodiceFolders` |
| Baixa | `presenceCorsOrigins` aceita `*` por design, enquanto Códice rejeita wildcard; isso é menos restritivo para presença pública. | `isOriginAllowed` |

# Arquitetura

## Estrutura do projeto

```txt
/workspace/hestia
├── hestia.js                         # Fastify local: API, segurança, SSR/static
├── chama/                            # Backend local: módulos do agente Chama
├── src/                              # Frontend TanStack Start/Router + componentes
│   ├── routes/                       # Rotas de UI file-based
│   ├── lib/hestia/                   # Cliente HTTP centralizado
│   ├── components/hestia/            # Componentes de domínio Héstia
│   ├── components/ui/                # Biblioteca UI shadcn/Radix
│   └── content/kaline.ts             # Conteúdo/registry de cards/endpoints
├── docs/                             # Documentação técnica e validações anteriores
├── scripts/                          # Instalação, doctor, setup local/Ollama/Hermes
├── packaging/                        # systemd, desktop, Debian hooks, binários wrapper
├── assets/icons/                     # Ícones de empacotamento
├── package.json                      # Dependências e scripts npm
├── vite.config.ts                    # Build TanStack/Vite
├── vitest.config.ts                  # Testes unitários e jsdom
└── tsconfig.json                     # TypeScript
```

## Diagrama de alto nível

```txt
Browser
  │
  │ SSR/static + chamadas /api/*
  ▼
hestia.js / Fastify
  │
  ├── Segurança HTTP
  │   ├── Host Guard / DNS rebinding
  │   ├── RateLimiter em memória
  │   ├── CORS opt-in por domínio de API
  │   └── headers CSP/XFO/nosniff
  │
  ├── Chama Local
  │   ├── Health/System/Hardware
  │   ├── Storage/Discovery/Scanner/Model
  │   ├── Organizer Plan/Apply/Undo/Redo
  │   ├── Códice Library/Stream/Import
  │   ├── LLM bridge para Ollama
  │   ├── Hermes inbox/outbox
  │   ├── Presence/Manifest/Snapshots/Events
  │   └── Station client
  │
  ├── Filesystem real
  │   ├── /KALINE ou HESTIA_STORAGE_PATH
  │   ├── ~/.chama/data ou STATE_DIRECTORY
  │   └── temp dirs do SO
  │
  └── Comandos locais
      ├── df
      ├── systemctl
      ├── lsblk
      └── soffice
```

## Fluxo de inicialização

1. `hestia.js` importa `config`, módulos Chama, segurança, SSR e rotas.
2. CLI `--host` e `--port` sobrescrevem `config.host`/`config.port`.
3. Se o bind não for loopback e `HESTIA_ALLOW_LAN` não for `1`, o processo aborta.
4. `ensureDataDir` cria diretórios persistentes de eventos, snapshots, plans e runs.
5. `setInterval` agenda snapshot a cada 60s e expurgo diário de dados antigos.
6. Fastify instala error handler, Host Guard, confirmação para `POST /api/local/*`, rate limit, CORS por namespace e headers de segurança.
7. Backend registra rotas `/api/*` e `registerCodiceRoutes`.
8. Se existe build TanStack, serve estáticos e encaminha fallback ao SSR; se não existe, não entrega UI e retorna erro orientando `npm run build`.
9. Fastify escuta em `config.host:config.port`.

## Fluxo HTTP

```txt
Requisição HTTP
  │
  ├─ onRequest Host Guard
  ├─ onRequest confirmação POST /api/local/*
  ├─ onRequest rate limit /api/*
  ├─ onRequest CORS LLM/Códice/Presence
  ├─ handler de rota
  ├─ onSend headers segurança + CORS resposta
  └─ errorHandler sanitizado
```

## Fluxo frontend

```txt
TanStack Start SSR
  │
  ├── __root.tsx: shell HTML, QueryClientProvider, error boundary
  ├── _station.tsx: StationShell + Outlet
  ├── rotas _station.*.tsx
  └── src/lib/hestia/api.ts
        ├── safeFetch / safePost
        ├── timeout e erro sem inventar dados
        └── hestiaApi/hestiaLegacyApi
```

## Fluxo backend

```txt
hestia.js
  ├── chama/config.js
  ├── chama/security.js
  ├── chama/storage*.js
  ├── chama/organizer*.js
  ├── chama/codice*.js
  ├── chama/llm.js
  ├── chama/hermes.js
  ├── chama/presence*.js
  └── chama/stationClient.js
```

# Rotas

## Middlewares globais

| Middleware/hook | Escopo | Autenticação/controle |
|---|---|---|
| Error handler | Todas | Remove stack trace, registra log interno |
| Host Guard | Todas | Rejeita `X-Forwarded-Host` e Host não permitido |
| Confirmação local | `POST /api/local/*` | Exige `X-Hestia-Local-Confirm: organize` |
| Rate limit | `/api/*` | 60 req/10s por IP |
| CORS LLM | `/api/llm/*` | Origem única `HESTIA_KALINE_CORS_ORIGIN` |
| CORS Códice | `/api/codice/*` | Origem allowlist `HESTIA_CODICE_CORS_ORIGIN`; wildcard rejeitado |
| CORS Presence | preflight `/api/presence/*` | Allowlist `HESTIA_PRESENCE_CORS_ORIGIN`, aceita `*` |
| Headers de segurança | Todas | CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy |

## Endpoints backend

| Método | URL | Arquivo/função | Auth/middleware | Payload | Resposta | Consumidor conhecido |
|---|---|---|---|---|---|---|
| GET | `/api/health` | `hestia.js` → `getHealth` | Host/rate | — | health local | Dashboard, config, endpoints, presence health |
| GET | `/api/llm/health` | `hestia.js` → `getLlmHealth` | Host/rate/CORS opt-in | — | runtime, modelos Ollama, allowlist | `/assistente`, Kaline externa |
| POST | `/api/llm/chat` | `hestia.js` → `generateLocalChat` | Host/rate/CORS opt-in | `{message, facet?, model?, contextBlock?, structuredPrompt?}` | texto gerado ou 400/503 | `/assistente`, Kaline externa |
| GET | `/api/hermes/status` | `getHermesStatus` | Host/rate | — | estado inbox/outbox | docs/possível externo |
| POST | `/api/hermes/process-once` | `processHermesOnce` | Host/rate + `X-Hestia-Local-Confirm: hermes` | não documentado no código de rota | processamento Hermes | Klio/Hermes |
| GET | `/api/server/status` | `getServerStatus` | Host/rate | — | OS, memória, uptime | dashboard |
| GET | `/api/storage/status` | `getStorageStatus` | Host/rate | — | uso de disco paths fixos | `/storage`, presence storage |
| GET | `/api/storage/discover` | `discoverVolumes` | Host/rate | — | volumes reais por `df` | documentado, não visto em UI principal |
| GET | `/api/storage/model` | `getStorageModel` | Host/rate | — | árvore canônica `/KALINE` | `/storage` |
| GET | `/api/storage/sources` | inline `{items: config.storageSources}` | Host/rate | — | fontes externas | `/storage` |
| GET | `/api/storage/scan` | `scanStorageModel`, `scanConfiguredSources` | Host/rate | — | resumo de arquivos | `/storage` |
| POST | `/api/local/organizer/plan` | `registerOrganizerRoutes` → `generateOrganizerPlan` + `writePlan` | Host/rate + header organize | query `extensions` opcional | plano persistido | `/organizar` |
| GET | `/api/hardware/status` | `getHardwareStatus` | Host/rate | — | saúde CPU/RAM/temp/services | `/sistema` |
| GET | `/api/hardware/config` | `getHardwareConfig` | Host/rate | — | host/lsblk/config | `/sistema` |
| GET | `/api/services/status` | `getServicesStatus` | Host/rate | — | systemd services | `/servicos`, dashboard, presence |
| GET | `/api/services/bindings` | `getServiceBindings` | Host/rate | — | vínculos de serviços | `/servicos`, dashboard |
| GET | `/api/logs` | `getLogs(tail)` | Host/rate | query `tail` 1..200 | ring buffer | `/logs`, dashboard |
| GET | `/api/station/connection` | `getStationConnectionStatus` | Host/rate | — | estado sanitizado Station | UI Station/config |
| GET | `/api/station/health` | `fetchStationHealth` | Host/rate | — | health remoto ou erro sanitizado | UI Station |
| GET | `/api/config` | inline config sanitizada | Host/rate | — | config pública | `/config` |
| GET | `/api/codice/health` | `registerCodiceRoutes` → `getCodiceHealth` | Host/rate/CORS | — | formatos disponíveis | docs/Códice externo |
| GET | `/api/codice/library` | `getCodiceLibrary` | Host/rate/CORS | — | livros | `/codice`, Códice externo |
| HEAD | `/api/codice/books/:bookId` | `resolveCodiceBook`, `openVerifiedCodiceBook` | Host/rate/CORS | path param hash | headers do livro | Códice externo |
| GET | `/api/codice/books/:bookId` | stream do fileHandle | Host/rate/CORS | path param hash | stream epub/pdf/txt | `/codice`, Códice externo |
| POST | `/api/codice/import` | `convertDocxToEpub` | Host/rate; sem confirmação local dedicada | body binário docx; query `name` | EPUB gerado em disco | `/codice` |
| ALL | `/api/codice/*` | wildcard | Host/rate/CORS | — | 404/405 | Defesa |
| POST | `/api/local/organizer/apply` | `applyOrganizerPlan` | Host/rate + `X-Hestia-Local-Confirm: organize` | `{planId, mode:"apply"}` | manifesto run | `/organizar` |
| GET | `/api/local/organizer/runs` | `getOrganizerRuns` | Host/rate | — | lista runs | `/organizar` |
| GET | `/api/local/organizer/runs/:runId` | `getOrganizerRun` | Host/rate | path param | manifesto | `/organizar` |
| POST | `/api/local/organizer/runs/:runId/undo` | `registerOrganizerRoutes` → `undoOrganizerRun` | Host/rate + header organize | path param | manifesto undo | `/organizar` |
| POST | `/api/local/organizer/runs/:undoRunId/redo` | `registerOrganizerRoutes` → `redoOrganizerRun` | Host/rate + header organize | path param | manifesto redo | `/organizar` |
| GET | `/api/presence/manifest` | `presenceRoute(getManifest)` | Host/rate/CORS opt-in | — | envelope presence | Presence externa |
| GET | `/api/presence/summary` | `getPresenceSummary` | Host/rate/CORS opt-in | — | resumo seguro | Presence externa |
| GET | `/api/presence/health` | `getHealth` | Host/rate/CORS opt-in | — | health envelopado | Presence externa |
| GET | `/api/presence/events/recent` | `getRecentEvents` | Host/rate/CORS opt-in | query `limit` 1..200 | eventos recentes | Presence externa |
| GET | `/api/presence/snapshots/latest` | `getLatestSnapshot` | Host/rate/CORS opt-in | — | último snapshot | Presence externa |
| GET | `/api/presence/services` | `getServicesStatus` | Host/rate/CORS opt-in | — | serviços | Presence externa |
| GET | `/api/presence/storage` | `getStorageStatus` | Host/rate/CORS opt-in | — | storage | Presence externa |
| GET | `/api/presence/backups` | `getBackupsPlan` | Host/rate/CORS opt-in | — | plano/stub backup | Presence externa |
| GET | `/api/presence/capabilities` | `getCapabilities` | Host/rate/CORS opt-in | — | capacidades | Presence externa |

## Divergências de rota

- Frontend chama `POST /api/local/organizer/runs/:runId/undo` e `POST /api/local/organizer/runs/:undoRunId/redo`.
- Backend registra `POST /api/local/organizer/runs/:runId/undo` e `POST /api/local/organizer/runs/:undoRunId/redo`.
- README documenta ambos os formatos em pontos diferentes, gerando ambiguidade.

# Configuração

## Fontes e precedência

```txt
CLI (--host/--port)
  > env HESTIA_HOST/HESTIA_PORT
  > ~/.chama/config.json whitelist
  > defaults
```

`~/.chama/config.json` aceita somente `host`, `port`, `storagePaths` e `services`; campos desconhecidos são ignorados.

## Variáveis de ambiente

| Variável | Uso | Default/fallback | Obrigatória? | Observação |
|---|---|---|---|---|
| `HESTIA_HOST` | bind HTTP | `127.0.0.1` | Não | LAN exige `HESTIA_ALLOW_LAN=1` se não-loopback |
| `HESTIA_PORT` | porta HTTP | `4517` | Não | CLI ganha precedência |
| `HESTIA_ALLOW_LAN` | permite bind não-loopback | bloqueia se diferente de `1` | Não | Controle de exposição sem auth |
| `HESTIA_STORAGE_PATH` | raiz storage/Códice/Organizer | `/KALINE` | Não | Também usado por legacy storage |
| `HESTIA_KALINE_ROOT` | fallback raiz storage | `/KALINE` | Não | Duplicado funcional de `HESTIA_STORAGE_PATH` |
| `HESTIA_DATA_DIR` | dados persistentes | `STATE_DIRECTORY` ou `~/.chama/data` | Não | Não vem do JSON do usuário |
| `STATE_DIRECTORY` | systemd state dir | primeiro item split por `:` | Não | Fallback infra |
| `HESTIA_RETENTION_PLANS_DAYS` | retenção planos | 7 dias | Não | Env apenas |
| `HESTIA_RETENTION_RUNS_DAYS` | retenção runs | 90 dias | Não | Env apenas |
| `HESTIA_RETENTION_EVENTS_DAYS` | retenção eventos | 30 dias | Não | Env apenas |
| `HESTIA_PRESENCE_CORS_ORIGIN` | CORS presence | vazio | Não | Lista CSV; aceita `*` |
| `HESTIA_KALINE_CORS_ORIGIN` | CORS LLM | vazio | Não | Origem única |
| `OLLAMA_URL` | URL interna Ollama | `http://127.0.0.1:11434` | Não | Nunca vem do cliente |
| `HESTIA_LLM_HEALTH_TIMEOUT_MS` | timeout health LLM | `HESTIA_LLM_TIMEOUT_MS` ou 5000 | Não | Numérico positivo validado em runtime |
| `HESTIA_LLM_CHAT_TIMEOUT_MS` | timeout chat LLM | `HESTIA_LLM_TIMEOUT_MS` ou 90000 | Não | Numérico positivo validado em runtime |
| `HESTIA_LLM_TIMEOUT_MS` | fallback legado LLM | health/chat defaults | Não | Compatibilidade |
| `HESTIA_HERMES_ROOT` | raiz Hermes | `${dataDir}/hermes` | Não | Cria/read dirs Hermes |
| `HESTIA_CODICE_CORS_ORIGIN` | CORS Códice | vazio | Não | CSV sem wildcard efetivo |
| `HESTIA_ALLOWED_HOSTS` | Host allowlist extra | vazio | Não | CSV; wildcards ignorados |
| `HESTIA_STATION_BASE_URL` | Station remoto | não configurado | Não | Deve ser origin puro |
| `HESTIA_STATION_TOKEN` | bearer Station | não configurado | Sim para Station real | Não exposto pelo `/api/config` |
| `HESTIA_STATION_TIMEOUT_MS` | timeout Station | default no módulo | Não | Validado pelo client |
| `NODE_ENV` | permite http loopback Station em dev | ambiente | Não | Controle Station |
| `VITE_HESTIA_BASE_URL` | docs de integração Códice | não usado no código local atual | Não | Config externa/documental |

## Configuração morta/duplicada/contraditória

- `storageSources: []` é exposto e escaneado, mas não é populado por env nem por `~/.chama/config.json`. Estado: **configuração aparentemente morta/incompleta**.
- `HESTIA_STORAGE_PATH` e `HESTIA_KALINE_ROOT` são aliases funcionais; duplicação intencional/legada.
- `config.readonly: true`, `readonlyByDefault: true` e `controlledWrites: true` coexistem com endpoints que escrevem (`organizer apply`, `organizer plan`, `codice import`, Hermes). Não é contraditório se interpretado como “leitura por padrão”, mas é perigoso se lido como read-only absoluto.
- `stationBaseUrl` é retornado em `/api/config`, mas não existe como propriedade direta de `config`; o spread de `publicStationConfig()` fornece flags sanitizadas. Campo pode sair `undefined`.

# Módulos

## Organizer

Responsabilidade: varrer entradas de `/KALINE`, gerar plano dry-run, persistir plano, aplicar move/copy, desfazer e refazer execuções com manifests.

Quem chama: `/api/local/organizer/plan`, `/api/local/organizer/apply`, `/api/local/organizer/*`, rota frontend `/organizar`.

Dependências: `storageModel`, `storageScanner`, `legacyStorageConfig`, `events`, `organizerIds`, filesystem.

Estado atual:

- Plano é gerado pela própria Héstia, não aceito do cliente.
- Plano é persistido em `dataDir/organizer/plans`.
- Apply só aceita `planId` e revalida paths antes de move/copy.
- Undo/redo usam manifests em `dataDir/organizer/runs`.
- Não há lock global entre geração/aplicação/undo/redo.

Pontos frágeis:

- Frontend usa endpoints de undo/redo incompatíveis com backend.
- `allowedSourceRoots()` em apply permite somente `/KALINE`; fontes externas planejadas como `copy` podem ser invalidadas se algum dia `storageSources` for populado fora de `/KALINE`.
- Transação é por item; não existe rollback automático total em caso de falha parcial.

## Storage

Responsabilidade: status de disco, descoberta de volumes, modelo canônico de `/KALINE`, scanner read-only.

Quem chama: `/storage`, dashboard, presence, organizer.

Dependências: `df`, filesystem, `legacyStorageConfig`, `config.storageSources`.

Estado atual:

- `storage.js` consulta paths fixos via `df -kP`.
- `storageDiscovery.js` lista mounts reais via `df -PTk` e filtra pseudo-filesystems.
- `storageModel.js` declara árvore canônica.
- `storageScanner.js` lista arquivos com limites.

Pontos frágeis:

- Sem `df`, endpoints degradam para indisponível.
- `storageSources` permanece vazio.

## Códice

Responsabilidade: biblioteca de livros em `/KALINE/codice/{epub,pdf,txt}`, indexação, IDs, stream seguro, importação docx→epub.

Quem chama: frontend `/codice`, Códice web app externo, docs de integração.

Dependências: filesystem, crypto, `soffice`, Fastify content-type parser.

Estado atual:

- EPUB e PDF são obrigatórios; TXT opcional.
- Cache de índice em memória por 5s.
- Limite de 5000 livros e profundidade 5.
- Ignora symlinks e dotfiles.
- IDs são `sha256(relPath).base64url`.
- Stream reabre arquivo com `O_NOFOLLOW` e compara dev/ino.
- Importação cria `codice/epub`, escreve docx temporário, executa LibreOffice e move EPUB final.

Pontos frágeis:

- Importação aceita upload binário e escrita sem header local específico.
- Usa `exec` com string shell; nomes são sanitizados, mas `execFile` seria padrão mais seguro.
- `convertDocxToEpub` retorna path absoluto no JSON de sucesso, vazando filesystem para consumidor local/remoto.
- Sem limite de tamanho explícito no body docx.

## Hermes

Responsabilidade: inbox/outbox local para comandos/lotes; `processHermesOnce` processa uma vez.

Quem chama: `/api/hermes/status`, `/api/hermes/process-once`, docs Klio/Hermes.

Dependências: filesystem em `config.hermesRoot`, header confirmação `X-Hestia-Local-Confirm: hermes` para processamento.

Estado atual: rota de escrita tem confirmação separada. Não foi validado fluxo manual com comandos reais.

## LLM

Responsabilidade: bridge local para Ollama; health e geração.

Quem chama: `/assistente`, Kaline/Klio externas via CORS opt-in.

Dependências: `fetch`, `OLLAMA_URL`, allowlist de modelos.

Estado atual:

- `ALLOWED_MODELS`: `qwen2.5:0.5b`, `qwen3.5-0.8b`, `qwen3.5-0.8b:latest`.
- `DEFAULT_MODEL`: `qwen3.5-0.8b`.
- Facets permitidas: `kaline`, `klio`, `kharis`.
- Limites: mensagem 12.000 chars; context/prompt block 40.000 chars cada.
- Timeouts: health 5s default; chat 90s default.
- Endpoint permite cliente escolher `model`, mas só dentro da allowlist.

Pontos frágeis:

- `qwen3.5-0.8b` pode não existir no Ollama real; health só lista modelos disponíveis, chat tentará o escolhido permitido.
- Prompt interno concatena blocos do cliente; há validação de tamanho/facet, mas não há separação de papéis/estrutura de mensagens.

## Health

Responsabilidade: saúde geral, versão, hostname, uptime, flags read-only, frontendBuilt, usuário de serviço e dataDir.

Quem chama: dashboard, endpoints, presence.

Estado: leitura local simples; não prova fluxo principal manual.

## Services

Responsabilidade: status systemd de lista fixa `jellyfin`, `smbd`, `tailscaled` ou lista do usuário.

Quem chama: `/servicos`, `/sistema`, presence, snapshots.

Dependências: `systemctl show` via `execFile` com timeout 2500ms.

Pontos frágeis: em ambiente sem systemd retorna `unavailable`; isso é aceitável como degradação.

## Snapshots

Responsabilidade: snapshot periódico de server/services, escrita atômica em `latest.json`, eventos de transição de serviços.

Persistência: `${dataDir}/snapshots/latest.json`, eventos JSONL.

Pontos frágeis: `lastSnapshot` é memória de processo; reinício perde comparação anterior.

## Hardware

Responsabilidade: CPU/RAM/swap/temperatura/serviços e config real do host.

Dependências: `node:os`, `/sys/class/thermal`, `lsblk`, `services`.

Pontos frágeis: `lsblk` indisponível degrada discos; temperaturas podem estar indisponíveis em VMs/containers.

## Presence

Responsabilidade: rotas públicas sanitizadas para presença/manifest/summary/events/snapshots/services/storage/backups/capabilities.

Dependências: dataDir, módulos existentes, CORS opt-in.

Pontos frágeis: `HESTIA_PRESENCE_CORS_ORIGIN=*` permite qualquer origem ler endpoints de presença; os dados são sanitizados, mas ainda expõem estado operacional.

## Station

Responsabilidade: cliente server-side para `hestia-station-agent` remoto, com token backend e resposta sanitizada.

Dependências: `HESTIA_STATION_BASE_URL`, `HESTIA_STATION_TOKEN`, timeout, `fetch`.

Pontos fortes: rejeita URL com path/search/hash, credenciais embutidas, redirect, content-type não JSON e body grande.

Pontos frágeis: sem env fica não configurado; fluxo real depende de agente externo não presente no repo.

# LLM

## Registro oficial

O registro oficial encontrado no repositório está em `chama/llm.js`:

- `ALLOWED_MODELS`: `qwen2.5:0.5b`, `qwen3.5-0.8b`, `qwen3.5-0.8b:latest`.
- `DEFAULT_MODEL`: `qwen3.5-0.8b`.
- Facets/tarefas conversacionais permitidas: `kaline`, `klio`, `kharis`.
- Endpoint de escolha de modelo: `POST /api/llm/chat`, campo opcional `model`.
- Consumidor frontend real encontrado: rota `/assistente`, que consulta `llmHealth` e chama `llmChat`.
- Consumidores externos documentados: Kaline/Klio via CORS opt-in para `/api/llm/*`.
- Modelos rápidos registrados nominalmente no repositório: `qwen2.5:0.5b`, `qwen3.5-0.8b` e `qwen3.5-0.8b:latest`; a auditoria não comprovou desempenho nem instalação física desses modelos.

## Modelos permitidos

| Modelo | Papel declarado | Uso real encontrado | Consumidor | Instalado comprovadamente? |
|---|---|---|---|---|
| `qwen2.5:0.5b` | Modelo permitido/compatível e opção rápida mencionada na UI/documentação. | Pode ser selecionado pelo cliente se aparecer em `llmHealth.models`; não é default. | `/assistente` e clientes externos de `/api/llm/chat`. | Não comprovado nesta auditoria. |
| `qwen3.5-0.8b` | Modelo padrão (`DEFAULT_MODEL`) e modelo leve/rápido esperado para chat local. | Default do backend quando `model` vem vazio; UI tenta selecionar se instalado. | `/assistente` e clientes externos de `/api/llm/chat`. | Não comprovado nesta auditoria. |
| `qwen3.5-0.8b:latest` | Variante/tag permitida do modelo padrão. | Pode ser selecionado pelo cliente se aparecer em `llmHealth.models`; não é default. | `/assistente` e clientes externos de `/api/llm/chat`. | Não comprovado nesta auditoria. |

## Tarefas associadas

| Tarefa/facet | Implementação real | Consumidor | Observação |
|---|---|---|---|
| `kaline` | Conversa local via prompt textual em `generateLocalChat`. | `/assistente`; clientes externos permitidos por CORS. | Facet default. |
| `klio` | Conversa local via o mesmo endpoint/prompt, sem pipeline separado encontrado. | Cliente externo/documentado. | Tarefa aceita, mas sem processamento especializado no backend atual. |
| `kharis` | Conversa local via o mesmo endpoint/prompt, sem pipeline separado encontrado. | Cliente externo/documentado. | Tarefa aceita, mas sem processamento especializado no backend atual. |
| Processamento de arquivos por LLM | Não encontrado como implementação real no runtime auditado. | — | Qualquer uso desse tipo deve ser tratado como planejado/documentado, não comprovado. |

## Validações e limites

- `message` deve ser string não vazia com no máximo 12.000 caracteres.
- `contextBlock` e `structuredPrompt` são opcionais, mas se presentes devem ser strings com no máximo 40.000 caracteres cada.
- `facet` é normalizada e precisa estar em `kaline`, `klio`, `kharis`.
- `model` é normalizado e precisa estar em `ALLOWED_MODELS`.
- O backend não aceita modelo arbitrário fora da allowlist.
- O frontend consegue escolher modelo quando usa `/assistente`, mas a escolha continua limitada pela allowlist do backend.

## Timeouts, fallback e indisponibilidade

- Health: `HESTIA_LLM_HEALTH_TIMEOUT_MS` → `HESTIA_LLM_TIMEOUT_MS` → 5000ms.
- Chat: `HESTIA_LLM_CHAT_TIMEOUT_MS` → `HESTIA_LLM_TIMEOUT_MS` → 90000ms.
- Se `model` vem ausente/vazio, há fallback para `DEFAULT_MODEL`.
- Não há fallback automático para outro modelo se o modelo escolhido/default não estiver instalado no Ollama.
- Se o cliente envia modelo fora da allowlist, o backend responde erro de modelo não permitido.
- Se Ollama está indisponível ou expira, health retorna `ok: false`; chat retorna 503 com `LLM_TIMEOUT` ou `OLLAMA_UNAVAILABLE`.

## Prompt interno

```txt
Faceta: <facet>

Regime de presença: <presencaRegime>

Contexto:
<contextBlock>

Prompt estruturado:
<structuredPrompt>

Mensagem original:
<message>
```

## Respostas explícitas

- O frontend consegue escolher um modelo? **Sim**, pela UI `/assistente`, desde que o modelo apareça no health/local e o backend aceite a allowlist.
- O backend aceita modelo arbitrário? **Não**; `POST /api/llm/chat` aceita o campo `model`, mas rejeita nomes fora de `ALLOWED_MODELS`.
- Existe allowlist? **Sim**, em `chama/llm.js`.
- Existe fallback? **Sim**, apenas de `model` ausente/vazio para `DEFAULT_MODEL`; **não** existe fallback automático para outro modelo instalado.
- Existe modelo registrado sem consumidor? **Não há consumidor exclusivo por modelo**; todos os modelos registrados compartilham o mesmo endpoint. `qwen2.5:0.5b` e `qwen3.5-0.8b:latest` podem ficar sem uso real se não forem selecionados por cliente ou não estiverem instalados.
- Existem modelos hardcoded fora do registro? **Não foi encontrado outro registro oficial de modelos no runtime auditado**. A UI também menciona `qwen2.5:0.5b` e `qwen3.5-0.8b`, alinhados ao registro; `qwen3.5-0.8b:latest` aparece no backend.
- Tarefas de processamento de arquivos realmente implementadas por LLM? **Não encontradas**; o processamento de arquivo real encontrado é o import/conversão do Códice via LibreOffice, não via LLM.
- Tarefas apenas planejadas/documentadas? Qualquer integração Klio/Kaline além do chat textual e qualquer processamento de arquivo por LLM deve ser considerada planejada/documentada até validação de implementação específica.

# Biblioteca

## Estrutura atual

```txt
<KALINE>/codice/
├── epub/   # obrigatório
├── pdf/    # obrigatório
└── txt/    # opcional
```

## Fluxo

```txt
Livro no filesystem
  ↓
Scan recursivo limitado
  ↓
ID = sha256(relativePath).base64url
  ↓
GET /api/codice/library devolve metadados e URL
  ↓
GET/HEAD /api/codice/books/:bookId resolve pelo índice
  ↓
open O_NOFOLLOW + dev/ino check
  ↓
Stream com headers privados/no-store
```

## Proteções

- Pastas permitidas fixas.
- Extensões permitidas: `.epub`, `.pdf`, `.txt`.
- Ignora dotfiles e symlinks no scan.
- Profundidade máxima 5.
- Limite de 5000 livros.
- Revalidação por `realpath`, containment e `O_NOFOLLOW` antes do stream.
- Content-Disposition sanitiza CR/LF/NUL/controles.
- Cache-Control `private, no-store`.

## Upload/escrita/endpoint inseguro

- Existe upload/import: `POST /api/codice/import` aceita body binário `.docx`.
- Existe escrita: cria `codice/epub`, escreve temporário, executa LibreOffice e move EPUB.
- Endpoint inseguro/ponto crítico: ausência de confirmação local dedicada, ausência de limite explícito de tamanho, `exec` shell string e retorno de path absoluto.

# Organizer

## Planos

- `generateOrganizerPlan` varre entradas do modelo `/KALINE` e aplica regras de extensão.
- Regras mapeiam extensões para destinos como `codice/pdf`, `midia/videos`, `ash/quarentena`, etc.
- Arquivos modificados há menos de 60s são ignorados como instáveis.
- Conflitos de target são marcados.
- Plano é persistido por `writePlan` em `dataDir/organizer/plans`.

## Manifests/runs

- Apply escreve manifesto de execução em `dataDir/organizer/runs`.
- Manifest inclui operações, status por item e eventos.
- Runs são listáveis e consultáveis.

## Undo/redo

- Undo move/copias reversas com base no manifesto.
- Redo reaplica a partir de um undoRunId.
- **Quebra atual:** frontend/documentação chamam URLs parametrizadas inexistentes.

## Journal/rollback/locks

- Journal efetivo: manifests JSON em runs + eventos JSONL.
- Rollback automático transacional total: **não existe**.
- Lock global/processual: **não encontrado**.
- Recuperação: manual via undo quando manifesto existe e paths ainda estão válidos.

## Corrupção possível

- Falha parcial em apply pode deixar parte dos arquivos movida/copied e parte skipped/failed; manifesto registra, mas não há rollback automático.
- Concorrência entre duas chamadas apply/undo/redo pode disputar os mesmos paths; não há lock.
- Expurgo de runs após 90 dias remove base de auditoria/undo histórico.

# Segurança

## Controles existentes

- CORS desligado por padrão, opt-in por namespace.
- Host Guard contra DNS rebinding.
- Rejeição de `X-Forwarded-Host`.
- Rate limit simples em memória para `/api/*`.
- Headers: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- `POST /api/local/*` exige confirmação custom header.
- Hermes exige confirmação própria.
- Códice stream valida symlink/traversal/toctou com realpath + O_NOFOLLOW + dev/ino.
- Services/storage/hardware usam `execFile` com argumentos fixos.
- Station token não é exposto ao cliente.

## Vulnerabilidades e riscos

| Severidade | Item | Detalhe |
|---|---|---|
| Alta, podendo se tornar Crítica | Códice import sem confirmação local dedicada | Severidade base: **Alta**. Pode se tornar **Crítica** se a Héstia estiver acessível fora de uma rede confiável ou se dispositivos não confiáveis fizerem parte da tailnet. |
| Alta | `exec` shell em conversor | `convertDocxToEpub` usa `exec(cmd)`; há sanitização de filename e paths temporários, mas shell string é risco desnecessário. |
| Alta | Sem limite explícito de upload | Body `.docx` pode consumir memória/disco; rate limit por requisição não limita tamanho. |
| Alta | Undo/redo quebrado no frontend | A operação de recuperação esperada pelo produto não funciona pela rota atual do cliente. |
| Resolvido | GET com efeito colateral | `/api/storage/organizer/plan` não existe mais como gerador; plano é `POST /api/local/organizer/plan`. |
| Média | Sem lock de Organizer | Corridas entre apply/undo/redo podem gerar inconsistência operacional. |
| Média | Presence CORS wildcard | `*` permitido para endpoints sanitizados, mas ainda expõe estado. |
| Média | Retorno de path absoluto | Códice import retorna `path` do EPUB no filesystem. |
| Baixa | CSP permite `unsafe-inline` | Justificado por hidratação TanStack, mas reduz proteção XSS. |
| Baixa | Rate limit em memória por IP | Suficiente para local simples, mas frágil atrás de proxy/NAT e reinicia com processo. |

### Refinamento específico — `POST /api/codice/import`

| Dimensão | Avaliação |
|---|---|
| Severidade técnica | Alta por combinar upload, escrita em disco e execução local do LibreOffice. |
| Pré-condições | Requisição precisa alcançar a Héstia e enviar corpo `.docx`; risco aumenta se a origem/cliente não for confiável ou se a rota estiver acessível fora do host/tailnet confiável. |
| Exposição real esperada | Baixa a moderada no cenário correto: Héstia local, sem internet pública, protegida por host guard e por Tailscale/rede confiável. Não comprovado no host físico. |
| Impacto | Escrita em `/KALINE/codice/epub`, execução de processo local, consumo de CPU/memória/disco e possível exposição de path absoluto no retorno. |
| Riscos mantidos | Escrita em disco; execução do LibreOffice; ausência de confirmação dedicada; contrato CORS inconsistente; possível sobrescrita de EPUB de mesmo basename; ausência de idempotência; ausência de autenticação/autorização de operação. |
| Quando vira Crítica | Se exposta diretamente à internet, se houver port forwarding público, se a tailnet incluir dispositivos não confiáveis, ou se CORS/Host allowlist forem configurados de forma ampla. |

# Persistência

| Persistência | Local | Formato | Escritor | Leitor | Risco |
|---|---|---|---|---|---|
| Data dir | `HESTIA_DATA_DIR`/`STATE_DIRECTORY`/`~/.chama/data` | diretórios | `ensureDataDir` | módulos vários | permissões |
| Eventos | `${dataDir}/events/events-YYYY-MM-DD.jsonl` | JSONL append-only | `appendEvent` | presence/events | linhas corrompidas são ignoradas; sem lock multi-processo |
| Snapshots | `${dataDir}/snapshots/latest.json` | JSON | `writeSnapshot` atomic rename | presence/snapshots | último snapshot apenas |
| Organizer plans | `${dataDir}/organizer/plans/*.json` | JSON | `writePlan` | apply | POST local cria; expira 7 dias |
| Organizer runs | `${dataDir}/organizer/runs/*.json` | JSON | apply/undo/redo | UI/API | expira 90 dias; base de undo some |
| Códice library | `<storageRoot>/codice/*` | arquivos reais | usuário/import | library/stream | upload escreve EPUB |
| Hermes | `${dataDir}/hermes` ou env | arquivos | Hermes/process | Hermes/status | depende de contrato externo |
| Logs | memória do processo | ring buffer | `log` | `/api/logs` | perde no restart |
| Cache Códice | memória do processo | objeto JS | `indexLibrary` | Códice routes | TTL 5s; não compartilhado multi-processo |

Não há SQLite nem banco relacional. Persistência é filesystem + JSON/JSONL + arquivos reais da biblioteca.

# Frontend

## Stack

- TanStack Start/Router para SSR e rotas file-based.
- TanStack Query provider no root, mas as chamadas principais usam hooks customizados `useApi`/`usePollingApi`.
- UI via React 19, Radix/shadcn, Tailwind 4, lucide-react.

## Rotas UI

| UI | Arquivo | Backend consumido |
|---|---|---|
| `/` | `_station.index.tsx` | health, server, services, bindings, logs/config conforme cards |
| `/storage` | `_station.storage.tsx` | storage status/model/sources/scan |
| `/organizar` | `_station.organizar.tsx` | organizer plan/apply/runs/undo/redo |
| `/codice` | `_station.codice.tsx` | codice library/import e links de stream |
| `/assistente` | `_station.assistente.tsx` | llm health/chat |
| `/sistema` | `_station.sistema.tsx` | hardware status/config |
| `/servicos` | `_station.servicos.tsx` | services status/bindings |
| `/logs` | `_station.logs.tsx` | logs |
| `/config` | `_station.config.tsx` | config |
| `/endpoints` | `_station.endpoints.tsx` | ping limitado a `/api/health` |
| `/historico` | `_station.historico.tsx` | verificar API específica no arquivo; rota existe |

## Telas sem backend ou endpoint inexistente

- Undo/redo em `/organizar` dependem de endpoints inexistentes no backend atual se usarem `hestiaLegacyApi.organizerUndo/Redo`.
- `/endpoints` só pinga `/api/health`; lista endpoints é informativa, não valida todos.
- `/codice` implementa upload real; backend existe, mas segurança/contrato CORS é inconsistente.

## Duplicações/componentes mortos

- Existem muitos componentes `src/components/ui/*` do scaffold shadcn; nem todos parecem usados pelo app atual.
- Existem `hestiaApi` e `hestiaLegacyApi` no mesmo arquivo; precisam ser mantidos em sincronia.
- Conteúdo `src/content/kaline.ts` funciona como registry/documentação de endpoints, mas pode divergir do backend.

# Testes

## Inventário

Testes backend: `backups`, `capabilities`, `codice`, `codiceConverter`, `dataDir`, `events`, `hardware`, `hermes`, `identity`, `llm`, `manifest`, `organizerApply`, `organizerIds`, `organizerPlan`, `organizerRedo`, `organizerUndo`, `pr28`, `presence`, `presenceSummary`, `retention`, `security`, `serviceBindings`, `services`, `snapshots`, `stationClient`, `storageDiscovery`, `storageModel`, `storageScanner`.

Testes frontend/lib: `DataCard`, `UnavailableNote.stableStringify`, `src/lib/hestia/api.test.ts`, `src/routes/-_station.storage.test.tsx`.

## O que provam

- Contratos de segurança isolados: Host Guard, rate limit, CORS.
- Códice: scan, symlink, traversal, stream, headers, alguns cenários de indisponibilidade.
- Organizer: IDs, plano, apply, undo, redo em unidade.
- Station: validação de contrato e falhas HTTP.
- LLM: allowlist, validação, timeout/falha.
- Storage: parsing/model/scanner.
- UI: alguns componentes e página storage.

## O que não provam

- App abrindo manualmente em navegador no ambiente real.
- Fluxo completo Organizer via UI incluindo undo/redo contra servidor real.
- Fluxo Códice import com LibreOffice real e arquivo real grande.
- Ollama real com modelo default instalado.
- Station agent real.
- Serviços systemd reais.
- Packaging Debian/systemd instalado em host real.

# Dependências

## Runtime principais

| Dependência | Versão | Uso | Observação |
|---|---:|---|---|
| `fastify` | ^5.9.0 | servidor HTTP local | essencial |
| `@fastify/static` | ^9.1.3 | servir build estático | essencial |
| `@tanstack/react-start` | ^1.168.26 | SSR app | pesado/central |
| `@tanstack/react-router` | ^1.170.16 | rotas | central |
| `@tanstack/react-query` | ^5.101.1 | provider/cache | parcialmente usado |
| `react`, `react-dom` | ^19.2.0 | UI | essencial |
| `zod`, `react-hook-form`, `@hookform/resolvers` | zod ^3.24.2, RHF ^7.71.2 | formulários/validação UI | uso efetivo deve ser verificado por `rg` antes de alterar |
| Radix packages | várias | componentes UI | muitos podem vir do scaffold e não serem usados |
| `lucide-react` | ^0.575.0 | ícones | usado |
| `recharts` | ^2.15.4 | gráficos | usado por chart/usage components se renderizados |
| `date-fns` | ^4.1.0 | datas | verificar uso efetivo antes de manter |
| `class-variance-authority`, `clsx`, `tailwind-merge` | várias | util UI | comuns no scaffold |
| `tailwindcss`, `@tailwindcss/vite` | ^4.2.1 | estilos/build | essencial UI |

## Dev principais

| Dependência | Uso |
|---|---|
| `vitest`, `jsdom`, `@testing-library/*` | testes |
| `eslint`, `typescript-eslint`, `prettier` | lint/formatação |
| `typescript`, `vite`, `@vitejs/plugin-react`, `@tanstack/router-plugin` | build TS/Vite |
| `nitro` | build TanStack Start |

## Dependências possivelmente mortas/pesadas

Sem remoção proposta nesta auditoria. Itens a verificar por uso real antes de qualquer limpeza: diversos Radix components não usados, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `vaul`, `react-resizable-panels`, `recharts`, `date-fns`, `react-hook-form`, `zod`. O projeto parece carregar scaffold UI amplo.

# Dívida Técnica

## Crítico

- Importação Códice combina upload + escrita + execução local sem confirmação dedicada.
- Fluxo undo/redo do Organizer quebrado por divergência frontend/backend/docs.
- Ausência de validação manual do produto real nesta auditoria.

## Importante

- Sem lock/transação global no Organizer.
- `exec` shell no conversor.
- Sem limite explícito de tamanho de upload.
- `storageSources` incompleto/morto.
- README e docs divergem de rotas reais.
- LLM default hardcoded pode não existir no host.
- Códice import retorna path absoluto.

## Melhoria

- Muitos componentes/dependências de scaffold potencialmente não usados.
- `/endpoints` não valida todos endpoints listados.
- Logs apenas em memória.
- `presenceCorsOrigins` com wildcard opcional deve ser explicitamente aceito como decisão de produto.
- CSP com `unsafe-inline` é compromisso técnico.

# Fluxos Quebrados

| Fluxo | Estado | Evidência |
|---|---|---|
| Organizer undo pela UI | Resolvido | Frontend e backend usam `/api/local/organizer/runs/:runId/undo` |
| Organizer redo pela UI | Resolvido | Frontend e backend usam `/api/local/organizer/runs/:undoRunId/redo` |
| README undo/redo manual | Divergente | README documenta URLs parametrizadas inexistentes em seção de Organizer |
| Storage sources externas | Incompleto | `config.storageSources` sempre `[]` no runtime atual |
| Produto “readonly” | Ambíguo | Há writes controlados e importação Códice |
| Códice import remoto via CORS | Divergente | Backend aceita POST, mas CORS anuncia GET/HEAD/OPTIONS; browser cross-origin tende a falhar no preflight |
| App sem build | Quebrado por design | hestia.js retorna “Interface não encontrada” se build SSR/static ausente |

# Incidentes

1. **INCIDENTE — fluxo principal não comprovado manualmente.** Testes automatizados e build não provam que app abre e que Organizer/Códice/LLM funcionam com dados reais.
2. **INCIDENTE — contrato undo/redo divergente.** Recuperação do Organizer pelo frontend não bate com rotas do backend.
4. **INCIDENTE — import do Códice com escrita e execução.** A rota combina upload, escrita local e execução do LibreOffice sem confirmação dedicada de operação.
5. **INCIDENTE — documentação operacional divergente.** README pode induzir operador a chamar endpoints inexistentes.
6. **INCIDENTE — storageSources exposto mas sem origem configurável ativa.** UI mostra feature que tende a permanecer vazia.

# Plano de Correção

Este plano é apenas documental nesta auditoria. Não criar PRs nem implementar estas fases neste trabalho.

## Fase 1 — Arrumar a casa

Inclui:

- corrigir divergência undo/redo;
- alinhar backend, frontend e README;
- revisar import do Códice;
- remover ou documentar configurações mortas;
- auditar o registro LLM existente;
- validar Storage e Organizer no host real.

Critério de saída:

- Héstia abre;
- Storage funciona;
- Organizer aplica;
- Undo funciona;
- Redo funciona;
- LLM responde em tarefa real;
- nenhum contrato documentado está divergente.

## Fase 2 — Biblioteca dedicada do Códice

Inclui:

- EPUB;
- PDF;
- TXT;
- IDs estáveis;
- scan;
- paginação;
- streaming;
- Range;
- ETag;
- cache;
- detecção de arquivos colocados via Samba.

Critério de saída:

- arquivo entra pelo Samba;
- Héstia detecta;
- Códice lista;
- Códice abre;
- PDF grande funciona corretamente.

## Fase 3 — Fronteira Héstia ↔ Códice

Inclui:

- contrato versionado;
- Tailscale;
- erros estáveis;
- timeouts;
- limites;
- indisponibilidade;
- compatibilidade de versões;
- autenticação adicional apenas se necessária.

## Fase 4 — Persistência canônica

Inclui:

- SQLite;
- progresso;
- destaques;
- notas;
- fichamentos;
- backup;
- restauração;
- integridade.

## Fase 5 — Sincronização offline

Inclui:

- deviceId;
- batchId;
- idempotência;
- checkpoints;
- conflitos;
- tombstones;
- fila local;
- restauração após formatação do celular.

## PR #1 — Housekeeping aplicado em 2026-07-14

### Contratos corrigidos

- Organizer plan: `POST /api/local/organizer/plan` é o único contrato que gera e persiste plano aprovável; rotas antigas em `/api/storage/organizer/plan` não geram nem persistem planos.
- Organizer undo/redo: frontend, backend e documentação usam somente `POST /api/local/organizer/runs/:runId/undo` e `POST /api/local/organizer/runs/:undoRunId/redo`, ambos com `X-Hestia-Local-Confirm: organize`.

### Configuração auditada

| Configuração | Estado | Decisão |
| --- | --- | --- |
| `services` | Usada | Mantida: whitelist em `~/.chama/config.json`, consumida por status/config. |
| `storagePaths` | Usada | Mantida: configura caminhos observados por storage status. |
| `storageRoot` / `HESTIA_STORAGE_PATH` / `HESTIA_KALINE_ROOT` | Duplicada compatível | Mantida com precedência documentada; `HESTIA_STORAGE_PATH` prevalece. |
| `storageSources` | Morta | Fora do escopo deste commit; permanece como configuração exposta porém não populada no runtime atual. |
| defaults de host/porta/retenção/LLM | Usados | Mantidos. |
| envs LLM | Usados | Mantidos; runtime usa registro oficial em `chama/llm.js`. |

### Responsabilidades consolidadas

- Console: UI e chamadas ao backend local.
- Station: integração externa opcional de estação; não substitui Chama Local.
- Organizer: geração/aplicação/undo/redo de planos locais aprovados.
- Storage: leitura de disco, modelo canônico `/KALINE` e fontes externas configuradas explicitamente; sem fontes fantasmas.
- Códice: leitura da biblioteca e import administrativo protegido; biblioteca dedicada/persistência canônica seguem fora de escopo.
