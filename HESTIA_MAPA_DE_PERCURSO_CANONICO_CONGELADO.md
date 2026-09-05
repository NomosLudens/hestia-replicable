# HÉSTIA — MAPA DE PERCURSO CANÔNICO E CONGELADO

**Status:** `FROZEN`  
**Branch canônica:** `master`  
**Data de congelamento:** 16/08/2026  
**Documento:** fonte canônica de percurso da Héstia

> **Héstia observa, apresenta e solicita.**  
> **Ela não executa arbitrariamente.**
>
> **Héstia não mantém as máquinas acordadas. Ela mantém a infraestrutura disponível para ser acordada.**

---

## 1. Decisão arquitetural final

A Héstia deixa de ser um aplicativo hospedado no notebook.

Ela passa a morar permanentemente na **TV Box**, equipamento de baixo consumo e ligado 24/7 dentro da rede doméstica.

Notebook, desktop e celular passam a ser apenas clientes da Héstia.

```text
CELULAR / NOTEBOOK / DESKTOP
          │
          │ PWA / navegador
          ▼
      TAILSCALE
          │
          ▼
        TV BOX
  ┌──────────────────────┐
  │ HÉSTIA CONSOLE       │
  │ HÉSTIA BACKEND       │
  │ TIMELINE             │
  │ RESUMO DO GUARDIÃO   │
  │ STATION LOCAL        │
  │ PI-HOLE              │
  │ EXECUTOR LAN RESTRITO│
  └──────────┬───────────┘
             │
             │ LAN / Tailnet
             ▼
        INFRAESTRUTURA
```

---

## 2. Papel canônico da Héstia

Héstia é o **cockpit web da infraestrutura K∧LINE**.

Ela responde quatro perguntas:

### AGORA
> Como está?

### HISTÓRICO
> O que aconteceu?

### RESUMO DO GUARDIÃO
> Preciso fazer alguma coisa?

### AÇÕES
> O que posso solicitar?

Héstia não é:

- organizador de arquivos;
- servidor de documentos;
- shell remoto;
- terminal administrativo;
- agente autônomo;
- sistema genérico de automação;
- substituta das Stations.

---

## 3. Organizer — decisão encerrada

A funcionalidade de organização de arquivos está **removida definitivamente do produto**.

```text
ORGANIZER=REMOVED
```

Motivo:

> organização de filesystem é melhor resolvida por VS Code, Codex e ferramentas especializadas.

A regressão do Organizer não deve ser revertida sem nova necessidade real e comprovada.

No lugar dele, Héstia possui:

```text
Linha do Tempo Operacional
+
Resumo do Guardião
```

---

## 4. Casa física da Héstia

### TV Box

A TV Box passa a ser o **host permanente da Héstia**.

Papel canônico:

```text
TV BOX
├── Héstia Console
├── Héstia Backend
├── Station local
├── Pi-hole
├── rede doméstica
├── Timeline operacional
├── Resumo do Guardião
└── executor LAN restrito
```

A Héstia não deve depender de:

- notebook ligado;
- desktop ligado;
- servidor i7 ligado;
- MAX ligada.

---

## 5. Acesso remoto

Caminho canônico:

```text
PWA / navegador
→ Tailscale
→ TV Box
→ Héstia
```

Decisão:

```text
CLOUDFLARE=YAGNI
PUBLIC_INTERNET=NO
REMOTE_ACCESS=TAILSCALE
```

Se necessário para HTTPS privado e instalação PWA, usar o mecanismo nativo da Tailnet apropriado ao host.

Não expor Héstia diretamente à Internet pública sem nova decisão arquitetural.

---

## 6. PWA

A PWA continua existindo.

Ela não é mais a “instalação da Héstia no notebook”.

Ela é o **cliente instalável da Héstia**.

Pode ser instalada em:

- celular;
- notebook;
- desktop.

Todos apontam para a mesma Héstia hospedada na TV Box.

```text
PWA = CLIENTE
TV BOX = HOST
```

---

## 7. Stations canônicas

Héstia observa seis Stations:

| Station | Papel |
|---|---|
| **Servidor** | armazenamento, projetos, `/KALINE`, VS Code remoto e serviços pesados sob demanda |
| **TV Box** | host da Héstia, Pi-hole, rede doméstica e executor LAN restrito |
| **Pocket** | ZeroClaw e runtime da Khora |
| **Baby** | Station sem responsabilidade operacional artificial neste momento |
| **Mini** | futura sentinela outside-in |
| **MAX** | computação cloud sob demanda |

IDs:

```text
desktop
tvbox
pocket
baby
mini
max
```

---

## 8. Servidor físico

O servidor i7 é recurso **sob demanda**.

Papel:

```text
armazenamento
+ projetos
+ /KALINE
+ VS Code remoto
+ serviços pesados
+ computação local
```

Ele não precisa permanecer ligado 24/7.

```text
SERVER_OFFLINE_BY_CHOICE != INCIDENT
```

Objetivo operacional:

```text
necessidade surge
→ Guardião abre Héstia
→ solicita wake-server
→ TV Box executa Wake-on-LAN
→ Héstia acompanha recuperação
→ Station responde
→ servidor fica ONLINE
```

---

## 9. Wake-on-LAN — capacidade canônica

`wake-server` é parte central do produto.

```text
WAKE_SERVER_PRODUCT_CAPABILITY=CANONICAL
```

Nova arquitetura mínima:

```text
Guardião
→ Héstia
→ executor local restrito na TV Box
→ Wake-on-LAN
→ servidor
```

A Baby não fica no caminho crítico.

Não criar:

```text
Héstia
→ Baby
→ TV Box
→ servidor
```

se a própria Héstia já está na TV Box.

Princípio YAGNI:

> não atravessar uma máquina adicional para executar uma ação que o host local já pode realizar com segurança.

---

## 10. Segurança do Wake

Héstia nunca deve receber poder arbitrário.

Permitido:

```text
wake-server
```

Proibido:

```text
exec(command)
run(command)
shell
terminal remoto genérico
reboot arbitrário
sudo arbitrário
```

A implementação deve usar ação conhecida, destino conhecido e resultado verificável.

Preferência:

```text
Héstia
→ comando local restrito
→ /usr/local/bin/wake-server
→ magic packet
```

Nunca aceitar comando shell vindo do frontend.

---

## 11. Semântica do Wake

```text
offline
→ wake_requested
→ starting
→ online
```

ou:

```text
offline
→ wake_requested
→ starting
→ failed
```

Regra absoluta:

> **Magic packet enviado não significa servidor acordado.**

`online` só pode ser apresentado depois de evidência real.

Preferencialmente:

```text
reachability
+
Station respondendo
```

---

## 12. Linha do Tempo Operacional

A Timeline é parte canônica da Héstia.

Ela registra **transições significativas**, não polling bruto.

Exemplos:

```text
station.down
station.up
service.down
service.up
```

E futuramente:

```text
wake.requested
wake.failed
wake.succeeded
outside_in.failure
outside_in.recovered
```

Não registrar CPU/RAM a cada ciclo como histórico de métricas.

---

## 13. Resumo do Guardião

O Resumo do Guardião é determinístico e não usa IA.

Prioridade:

```text
1. incidentes ativos
2. nós inesperadamente indisponíveis
3. erros de configuração/autenticação
4. recuperações recentes
5. recursos offline por escolha
6. estado geral
```

Nunca transformar:

```text
UNKNOWN → HEALTHY
NOT_CONFIGURED → EXPECTED_OFFLINE
```

---

## 14. MAX

MAX permanece como computação cloud sob demanda.

Estados possíveis:

```text
NOT_CONFIGURED
EXPECTED_OFFLINE
ONLINE
UNREACHABLE
AUTH_FAILED
DEGRADED
```

`NOT_CONFIGURED` nunca deve ser apresentado como `offline por escolha`.

MAX não é requisito 24/7.

---

## 15. Pocket

Papel congelado:

```text
POCKET
→ ZeroClaw
→ Khora
```

Não mover Khora para Héstia.

---

## 16. Mini

Mini permanece planejada como:

> **sentinela outside-in**

Papel futuro:

```text
HOST_UP
HOST_DOWN
SERVICE_UP
SERVICE_DOWN
TIMEOUT
LATENCY
```

Mini observa de fora.

Mini não executa recuperação.

Mini não reinicia máquinas.

Mini não vira Control Plane.

---

## 17. Baby

A decisão anterior de transformar Baby em Control Plane está **revogada**.

Motivo:

> com Héstia hospedada na TV Box, colocar Baby entre Héstia e a LAN cria complexidade sem necessidade.

Estado atual:

```text
BABY_ROLE=UNASSIGNED_SPECIALIZATION
BABY_STATION=KEEP
BABY_CONTROL_PLANE=YAGNI
```

Não inventar função para justificar a existência da VM.

Uma função futura só será criada se houver necessidade real.

---

## 18. Sequência de implementação congelada

### ETAPA 1 — MIGRAR HÉSTIA PARA A TV BOX

Objetivo:

```text
Héstia sai do notebook
→ instala na TV Box
→ systemd
→ backend e frontend disponíveis
→ dados persistentes preservados
```

Gate:

```text
HESTIA_TVBOX_HOST=PASS
SYSTEMD=PASS
CONSOLE_REAL=PASS
TIMELINE_REAL=PASS
GUARDIAN_SUMMARY_REAL=PASS
```

---

### ETAPA 2 — ACESSO REMOTO PRIVADO

Objetivo:

```text
celular
→ Tailscale
→ Héstia na TV Box
```

Validar fora da LAN local.

Gate:

```text
REMOTE_PRIVATE_ACCESS=PASS
MOBILE_5G_ACCESS=PASS
PUBLIC_EXPOSURE=NO
```

---

### ETAPA 3 — PWA REAL

Objetivo:

```text
abrir Héstia remota
→ instalar PWA
→ ícone oficial
→ standalone
→ reabrir
→ telemetria real
```

Gate:

```text
PWA_INSTALL_REAL=PASS
NEW_ICON_VISIBLE_REAL=PASS
STANDALONE_REAL=PASS
REAL_DATA_AFTER_INSTALL=PASS
```

---

### ETAPA 4 — WAKE-SERVER REAL

Objetivo:

```text
servidor offline por escolha
→ Guardião solicita despertar
→ TV Box envia magic packet
→ servidor inicia
→ Héstia verifica recuperação
```

Gate:

```text
WAKE_SERVER_REAL=PASS
FALSE_WAKE_SUCCESS=NO
SERVER_RECOVERY_CONFIRMED=PASS
TIMELINE_WAKE_EVENT=PASS
```

---

### ETAPA 5 — SEIS STATIONS REAIS

Validar:

```text
desktop
tvbox
pocket
baby
mini
max
```

Gate:

```text
STATIONS_EXPECTED=6
STATIONS_REAL=6
REAL_TELEMETRY=PASS
FAILURE_ISOLATION=PASS
RECOVERY=PASS
```

---

### ETAPA 6 — MINI OUTSIDE-IN

Somente depois de Héstia + Wake estarem fechados.

Objetivo:

```text
Mini
→ verifica infraestrutura de fora
→ Héstia recebe evidência externa
→ Timeline registra divergências
```

Gate:

```text
MINI_SENTINEL_REAL=PASS
REAL_PROBES=PASS
NO_REMOTE_ACTIONS=PASS
```

---

### ETAPA 7 — BABY

Não existe tarefa obrigatória.

```text
BABY_NEXT_STEP=NONE
```

Só reabrir Baby quando uma necessidade concreta aparecer.

---

## 19. Ordem canônica

```text
1. Héstia → TV Box
2. acesso remoto via Tailnet
3. PWA real
4. Wake-on-LAN local
5. seis Stations reais
6. Mini outside-in
7. Baby somente se necessária
```

Não mudar essa ordem sem motivo operacional comprovado.

---

## 20. Arquitetura final desejada

```text
             CELULAR
             NOTEBOOK
             DESKTOP
                 │
                 │ PWA / Browser
                 ▼
              TAILSCALE
                 │
                 ▼
              TV BOX
      ┌──────────────────────┐
      │ HÉSTIA               │
      │ Console + Backend    │
      │ Timeline             │
      │ Resumo do Guardião   │
      │ Pi-hole              │
      │ Station local        │
      │ Wake executor        │
      └──────────┬───────────┘
                 │
        ┌────────┼──────────────┐
        │        │              │
        ▼        ▼              ▼
     SERVIDOR  POCKET          MINI
     on-demand Khora        outside-in
        │
        └───────────┐
                    ▼
                   MAX
                on-demand

BABY
└── Station preservada, sem função artificial
```

---

## 21. Regra de produto real

Uma capacidade só existe quando:

```text
interface abre
+
dados são reais
+
ação manual funciona
+
resultado é verificável
+
falha aparece como falha
+
nenhum mock participa do fluxo principal
```

Build verde não é prova operacional.

---

## 22. Congelamento

Este documento está **congelado**.

```text
DOCUMENT_STATUS=FROZEN
ARCHITECTURE_STATUS=FROZEN
ROADMAP_STATUS=FROZEN
```

Decisões congeladas:

```text
HESTIA_HOST=TV_BOX
HESTIA_CLIENT=PWA
REMOTE_ACCESS=TAILSCALE
CLOUDFLARE=YAGNI
ORGANIZER=REMOVED
TIMELINE=CANONICAL
GUARDIAN_SUMMARY=CANONICAL
WAKE_SERVER=CANONICAL
WAKE_EXECUTOR=TV_BOX_LOCAL
BABY_CONTROL_PLANE=REMOVED_FROM_PLAN
MINI=OUTSIDE_IN_SENTINEL
MAX=ON_DEMAND_COMPUTE
SERVER=ON_DEMAND_WORKSTATION_STORAGE
```

Só reabrir uma decisão congelada se houver:

1. falha operacional comprovada;
2. nova necessidade real;
3. restrição técnica concreta;
4. evidência de que a arquitetura atual não atende ao produto.

Preferência estética, vontade de refatorar ou descoberta de tecnologia nova **não são motivos suficientes**.

---

# ESSÊNCIA FINAL

> **Héstia é o cockpit web da infraestrutura K∧LINE.**

Ela mora na TV Box porque a TV Box permanece disponível.

Ela observa o que está ligado.

Ela entende o que está desligado por escolha.

Ela registra o que aconteceu.

Ela informa o que exige atenção.

Ela pode solicitar ações restritas.

Ela acorda recursos quando necessário sem possuir poder arbitrário.

E não mantém máquinas caras ligadas apenas para continuar existindo.

> **Héstia não mantém as máquinas acordadas.  
> Ela mantém a infraestrutura disponível para ser acordada.**
