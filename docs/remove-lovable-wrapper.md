# Remoção do wrapper Lovable

Este PR remove o acoplamento direto da Héstia ao `@lovable.dev/vite-tanstack-config`.

A partir deste ponto, o build passa a usar configuração explícita com:

- Vite;
- TanStack Start;
- React plugin oficial do Vite;
- Tailwind Vite plugin;
- vite-tsconfig-paths.

O `server.entry = "server"` foi preservado para manter o wrapper SSR atual em `src/server.ts`.

## Escopo

- `vite.config.ts` deixa de importar `@lovable.dev/vite-tanstack-config`.
- `package.json` remove a devDependency do Lovable.
- `bun.lock` foi removido porque era lockfile herdado do ambiente Lovable e ainda continha referências ao cache/escopo Lovable.

## Cloudflare

A Héstia não é um Worker público.

O Worker `hestia` foi removido/desconectado fora do repositório, no painel da Cloudflare. Este repo não deve conter configuração de deploy público da Héstia para Cloudflare Workers.

Modelo correto:

```txt
Presence → Cloudflare
Héstia   → PC local / Linux Mint / systemd / localhost:4517
```

Se a Cloudflare ainda tentar criar deploy para este repo, isso é resíduo de integração externa e deve ser removido no painel da Cloudflare, não corrigido adaptando a Héstia para Worker.

## Fora de escopo

- Organizer.
- Storage.
- API local.
- systemd.
- packaging.
- UI.
- Presence.

## Validação esperada

```bash
npm install
npm test
npm run build
npm run lint
```

Depois:

```bash
npm run hestia
curl -s http://localhost:4517/api/health | jq
```
