# Diagnóstico PWA — Héstia Console

Diagnóstico real do estado do Web App/PWA da Héstia Console antes de quaisquer alterações.

```text
MANIFEST_EXISTS=yes
MANIFEST_LINKED=yes
ICON_192_EXISTS=yes
ICON_512_EXISTS=yes
DISPLAY_STANDALONE=yes
START_URL_VALID=yes
SCOPE_VALID=yes
THEME_COLOR=yes
INSTALL_PROMPT_EXISTS=yes
INSTALL_BUTTON_EXISTS=yes
ALREADY_INSTALLED_HANDLING=yes
SERVICE_WORKER_EXISTS=no
HTTPS_REQUIRED=yes (excluindo localhost/127.0.0.1)
CURRENT_INSTALLABILITY=yes (via localhost com critérios modernos do Chrome/PWA)
```

## Auditoria Adicional

- **Comportamento Mobile**: O layout utiliza Tailwind CSS com classes responsivas (grids que se adaptam em telas mobile, navegação compacta e fontes redimensionáveis).
- **Comportamento Desktop**: Exibição completa em grid de duas colunas (ou mais) com painéis de hardware dinâmicos e cards de Stations.
- **Abertura Standalone**: Configurada corretamente com `"display": "standalone"`. Ao ser instalada e iniciada, a barra de navegação do browser é ocultada, oferecendo a experiência de aplicativo nativo.
- **Navegação TanStack em Modo Instalado**: As rotas no frontend usam `@tanstack/react-router`, que gerencia o estado das páginas client-side por meio de rotas baseadas em hash/caminho sem recarregar a página, mantendo o estado standalone funcionando perfeitamente.
- **Favicon**: O favicon é declarado inline via SVG e PNG no arquivo `src/routes/__root.tsx`.
- **Apple Touch Icon**: Declarado apontando para `/icons/hestia-192.png`.
- **Segurança do Backend**: Os tokens das Stations (`HESTIA_*_TOKEN`) e URLs base ficam restritos ao runtime do Fastify no backend (`hestia.js` + `chama/`) e nunca são enviados para o navegador. O endpoint `/api/config` envia apenas booleanos (`desktopConfigured`, `tvboxConfigured`, etc.) e flags públicas, sem expor credenciais.
- **Comportamento sob Indisponibilidade**: Se o backend da Héstia Console ou qualquer uma das Stations canônicas estiver temporariamente offline, os dados são exibidos de forma honesta como `unavailable` / `offline` e a UI não renderiza dados fictícios ou ficticiamente "verdes".
- **Service Worker**: Pelo princípio `YAGNI` (You Aren't Gonna Need It) e considerando que o acesso é local em `http://localhost:4517` (onde o Chrome permite instalação sem Service Worker ativo em versões modernas), **não será criado** nenhum Service Worker redundante ou caches locais que possam congelar dados reais de telemetria.
