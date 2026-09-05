# Refinamento estético — puxar Kaline Central para a família visual de _totalidade_ (Kalisto)

Mantém tudo que já está de pé (14 rotas, `/tv` com 4 modos, Mapa, Onboarding, Verdade, Códice, estados honestos, sem backend). Só re-afina tokens, tipografia, motion e microinterações para entrar na mesma família visual do projeto irmão.

## O que a Kaline herda de _totalidade_

**Paleta em oklch, com vinho/borgonha como profundidade**
Substitui os tokens atuais em `src/styles.css`:

```
--obsidian:  oklch(0.11 0.012 30)
--burgundy:  oklch(0.25 0.09 15)   ← nova camada de fundo, atrás do cobre
--wine:      oklch(0.31 0.12 12)
--copper:    oklch(0.68 0.11 55)   (cobre envelhecido, mantido como identidade Kaline)
--gold:      oklch(0.76 0.13 75)   ← novo, para focus/glow/detalhe fino
--amber:     oklch(0.82 0.14 65)
--ember:     oklch(0.63 0.22 30)   (brasa, só detalhes)
--ivory:     oklch(0.94 0.025 75)  ← substitui #F4EDE4
--ivory-dim: oklch(0.78 0.035 75)  ← substitui --kaline-muted
```

Fundo do `body` ganha 3 radiais em vinho/borgonha + 1 em dourado bem baixo (mesma receita do totalidade), sobre obsidian. Textura de ruído fino continua.

**Tipografia clássica**

- `--font-serif: "Cormorant Garamond"` (substitui Fraunces nos títulos e no wordmark K∧LINE — fica mais editorial, menos "SaaS moderno").
- `--font-sans: "Inter"` (substitui Inter Tight — mesma família do totalidade).
- Trocar o `<link>` de fontes no `__root.tsx`.

**Motion tokens (novos em `:root`)**

```
--ease-spring, --ease-snap, --ease-out-soft
--dur-instant 90ms · --dur-fast 160ms · --dur-med 260ms · --dur-slow 420ms
```

**Utilitários adotados**

- `.serif`, `.gold-glow`, `.copper-glow` (versão Kaline do apple-glow, respirando 4.5s no wordmark do Hero e da TV).
- `.lift-card` — substitui `kaline-glass-hover` atual, com curva `--ease-out-soft` e sombra tintada de cobre/dourado.
- `.press-scale` — feedback tátil `scale(0.97)` em todos os botões e cards clicáveis.
- `.fade-up` + `.stagger` — entrada suave das grades de cards (Home, Códice, Dispositivos, etc.).
- `.shimmer` — reservado para skeletons futuros (não usado agora, só definido).

**Foco e mobile**

- `:focus-visible` com halo dourado 2px, offset 2px (substitui azul default).
- `@media (pointer: coarse)`: mínimo 44×44 em `button/[role]/a[role]` — importante para a TV Box e para celular.
- Safe-area helpers (`.safe-bottom`, `.safe-top`, `.pb-safe`).
- `overscroll-behavior-y: none`, `touch-action: manipulation`, `overflow-x: clip`.

**View Transitions API**
Habilitar crossfade nativo entre rotas com `::view-transition-old/new(root)` (fade + translate leve). Sem framer-motion.

**`prefers-reduced-motion`**
Desliga `.fade-up`, `.stagger`, `.shimmer`, `.press-scale` para quem pediu.

## Mudanças pontuais nos componentes existentes

Todas cirúrgicas, sem reescrever arquitetura:

- **`StatusBadge`** — trocar `text-[color:var(--kaline-copper)]` etc. pelos novos nomes (`--copper`, `--gold`, `--ivory-dim`). Manter variantes (`waiting`, `planned`, `future`…) e o `kaline-pulse`.
- **`GlassCard`** — passa a compor `.lift-card .press-scale` no lugar de `kaline-glass-hover`; radius 16px, borda 1px `oklch(gold / 0.18)`.
- **`KalineMark`** — usa `.serif` (Cormorant) e ganha classe `.copper-glow` (respirando devagar) nos tamanhos `lg`/`xl` (Hero e TV/Silêncio). `∧` fica dourado, com peso 500.
- **`HeroKaline`** — troca "Fraunces" implícito por `.serif` novo; título ganha `apple-glow` no wordmark; entrada `.fade-up`. Copy e composição intactas.
- **`TopBar`** — botão "Conectar Station Agent" continua desabilitado; ganha `.press-scale` disable-safe (transição, sem transform ao clicar).
- **`SidebarNav`** — item ativo passa a usar tinta dourada/vinho suave; hover com `--ease-out-soft`; entrada `.stagger` na primeira montagem.
- **`ServiceCard` / grades da Home, Códice, Dispositivos, Mídia, Backups** — envolver a grade com `.stagger` para animação escalonada de entrada.
- **`PrincipleCard`** (Verdade operacional) — halo com vinho + dourado (mais quente e cerimonial), citação em Cormorant.
- **`StationMap`** — linhas SVG passam para gradiente `copper → wine` (menos brasa, mais borgonha); glifos em dourado; nós com fill `oklch(0.14 0.025 25 / 0.85)`.
- **`BookshelfPlaceholder`** — lombadas em degradês vinho/obsidian; fitilhos internos em dourado.
- **`LocalClock` (TV)** — números em Cormorant, com `.copper-glow` leve nos tamanhos grandes (Silêncio).
- **Kaline TV** — atmosfera ganha halo vinho no topo + dourado embaixo; tabs de modo com `.press-scale`; entrada de cada modo com `.fade-up`.

## O que NÃO muda

- Nenhuma nova rota, nenhuma alteração de conteúdo, nenhum backend, nenhum ícone novo, nenhum gráfico, nenhuma métrica.
- Vocabulário proibido continua proibido (_online, ativo, sincronizado, concluído_).
- `/tv` continua pública, sem shell, com relógio rotulado "hora local deste dispositivo".
- Botão "Conectar Station Agent" continua desabilitado, sem modal.
- Ordem mobile continua Home · TV · Central · Dispositivos.
- Sem framer-motion (usa View Transitions + keyframes CSS).

## Arquivos tocados

- `src/styles.css` — reescrito para adotar paleta oklch, motion tokens, utilitários e View Transitions.
- `src/routes/__root.tsx` — trocar `<link>` de fontes (Cormorant Garamond + Inter).
- `src/components/kaline/*` — ajustes cirúrgicos de classes (StatusBadge, GlassCard, KalineMark, HeroKaline, TopBar, SidebarNav, StationShell, StationMap, BookshelfPlaceholder, PrincipleCard, LocalClock) e envolver grades com `.stagger`.
- `src/routes/tv.tsx` — ajustes de classes (halos, tabs, entrada dos modos).

Sem novos arquivos. Sem novas dependências.

## Entrega

Uma Kaline mais quente, mais editorial, mais família com Kalisto: obsidian + vinho + dourado + cobre, Cormorant Garamond nos títulos, cards com press/lift, entrada em fade-up escalonado, foco dourado, transições nativas entre rotas e cuidados táteis mobile — tudo sem alterar arquitetura, conteúdo ou estados honestos.
