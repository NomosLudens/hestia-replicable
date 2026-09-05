# Héstia

> **Atribuição obrigatória:** Héstia, por Nomos Ludens — https://github.com/NomosLudens/hestia-replicavel. Consulte o arquivo [LICENSE](https://github.com/NomosLudens/hestia-replicavel/blob/master/LICENSE).

**Console de observabilidade e operação controlada para uma infraestrutura distribuída de pequenos servidores e estações Linux.**

Héstia resolve um problema prático: acompanhar o estado real de vários dispositivos independentes sem transformar o painel em um shell remoto genérico.

O projeto combina uma **Console** central com **Station Agents** instalados nos hosts monitorados. A Console agrega saúde, armazenamento, serviços, atualizações e inventário de software; ações de escrita existem apenas quando são específicas, delimitadas e verificáveis.

## O que faz

No estado atual documentado pelo projeto, Héstia oferece:

- visão consolidada de múltiplas estações Linux;
- health checks e estado de sistema, armazenamento e serviços;
- inventário dinâmico de unidades `systemd` a partir do host real;
- inventário de aplicativos e pacotes disponíveis no dispositivo;
- observação de atualizações do sistema;
- atualização controlada de aplicativos quando o provider permite uma ação determinística;
- suporte a estações somente leitura;
- ações operacionais específicas, como wake/suspend, quando configuradas;
- transporte privado entre Console e Agents, configurado fora do aplicativo.

A interface não deve inventar métricas. Estado indisponível permanece indisponível; erro de autenticação, host offline e recurso não configurado são estados distintos.

## Estado atual

**Active development**

A arquitetura de Console + Station Agent está implementada e o histórico do projeto registra validações em hosts reais, inclusive comparação do inventário exposto pela aplicação com o `systemd` da estação monitorada.

Isso não significa que qualquer instalação esteja automaticamente funcional: cada Station depende do runtime, configuração e transporte privado do ambiente em que for instalada.

## Arquitetura

```text
Browser
  ↓
Héstia Console
  ↓
transporte privado
  ↓
Station Agent
  ↓
Linux / systemd / providers locais
```

A Console apresenta e coordena. O Station Agent coleta estado local e expõe uma API restrita. O transporte entre máquinas é responsabilidade da infraestrutura onde Héstia é instalada.

### Limite de segurança

Héstia **não oferece shell remoto nem endpoint de execução arbitrária**.

As operações seguem dois princípios:

```text
OBSERVABILITY = READ_ONLY BY DEFAULT
CONTROLLED_ACTION = SPECIFIC + AUTHORIZED + VERIFIED
```

Para atualizações que exigem autorização local, a credencial é tratada como dado efêmero da operação e não deve ser persistida ou devolvida ao frontend.

## Tecnologias

O projeto usa, entre outras:

- JavaScript e TypeScript;
- Node.js;
- React 19;
- TanStack Router / Start / Query;
- Vite;
- Fastify;
- Linux e `systemd`;
- Vitest para regressão automatizada.

## Desenvolvimento

Requer Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Gates disponíveis no projeto:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run station:doctor
npm run station:smoke
```

Instalação, endpoints privados, tokens e topologia real pertencem à configuração local de cada ambiente e **não devem ser versionados com valores operacionais**.

## Validação operacional

CI e fixtures protegem contra regressões, mas não substituem validação física. Uma Station só deve ser considerada operacional quando o serviço, o Agent protegido, o transporte privado e a Console forem verificados no host real correspondente.

## Documentação técnica

O repositório mantém documentação detalhada de instalação, arquitetura e validação em [`docs/`](docs/). Parte desses documentos registra decisões históricas e auditorias técnicas; eles não substituem a configuração segura do ambiente de implantação.

## Status

**Active development** — projeto de infraestrutura e observabilidade da Nomos Ludens, apresentado como demonstração de automação, sistemas distribuídos leves e operação local-first.
