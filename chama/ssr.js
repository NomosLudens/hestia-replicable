// Chama Local — ponte entre o Fastify local e o bundle SSR do Nitro/TanStack
// Start. hestia.js só serve `/api/*` e estáticos; para as rotas da SPA
// (`/`, `/config`, `/endpoints`, `/logs`, ...) delega a renderização para o
// bundle já buildado (ex.: `.output/server/index.mjs`), que exporta um
// `fetch(request, env, ctx)` no formato Cloudflare Workers module — funciona
// sob Node puro desde que `ctx` tenha `waitUntil`/`passThroughOnException`.
import { pathToFileURL } from "node:url";

const HOP_BY_HOP_HEADERS = new Set(["content-length", "transfer-encoding", "connection"]);

export function buildSsrRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const url = `${req.protocol}://${req.headers.host}${req.url}`;
  return new Request(url, { method: req.method, headers });
}

// content-encoding é preservado de propósito: o Response do bundle já vem
// com o corpo comprimido quando esse header existe (não é uma resposta de
// rede real, então nada o descomprime por baixo dos panos). content-length/
// transfer-encoding/connection ficam a cargo do próprio Fastify.
export function copyResponseHeaders(response, reply) {
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    reply.header(key, value);
  });
}

export function createSsrFetcher(serverEntryPath) {
  let handlerPromise;
  return async function ssrFetch(req) {
    if (!handlerPromise) {
      handlerPromise = import(pathToFileURL(serverEntryPath).href).then(
        (mod) => mod.default ?? mod,
      );
    }
    const handler = await handlerPromise;
    const request = buildSsrRequest(req);
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
    return handler.fetch(request, {}, ctx);
  };
}
