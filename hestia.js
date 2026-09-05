// Héstia Console — CLI server. Importa endpoints read-only da Chama Local
// e serve o frontend buildado como console puro da TV Box.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

import { config } from "./chama/config.js";
import { publicStationConfig } from "./chama/stationClient.js";
import { registerStationRoutes } from "./chama/stationRoutes.js";
import { getHealth } from "./chama/health.js";
import { getServerStatus } from "./chama/system.js";
import { getStorageStatus } from "./chama/storage.js";
import { discoverVolumes } from "./chama/storageDiscovery.js";
import { getStorageModel } from "./chama/storageModel.js";
import { scanStorageModel, scanConfiguredSources } from "./chama/storageScanner.js";
import { getServicesStatus } from "./chama/services.js";
import { getHardwareStatus, getHardwareConfig } from "./chama/hardware.js";
import { getServiceBindings } from "./chama/serviceBindings.js";
import { getLogs, log } from "./chama/logs.js";
import {
  isLoopbackHost,
  buildAllowedHosts,
  isAllowedHostHeader,
  isOriginAllowed,
  RateLimiter,
  applyCodiceCors,
} from "./chama/security.js";
import { registerCodiceRoutes } from "./chama/codiceRoutes.js";

import { createSsrFetcher, copyResponseHeaders } from "./chama/ssr.js";
import { ensureDataDir } from "./chama/dataDir.js";
import { runSnapshotCycle, SNAPSHOT_INTERVAL_MS, getLatestSnapshot } from "./chama/snapshots.js";
import { sweepOldData } from "./chama/retention.js";
import { getManifest } from "./chama/manifest.js";
import { getRecentEvents } from "./chama/events.js";
import { getIdentity } from "./chama/identity.js";
import { getPresenceSummary } from "./chama/presenceSummary.js";
import { getBackupsPlan } from "./chama/backups.js";
import { getCapabilities } from "./chama/capabilities.js";
import { presenceRoute } from "./chama/presence.js";
import { createReadStream } from "node:fs";

// --- CLI flags: --port <n> / --host <h> / --help ----------------------------
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = String(argv[++i]);
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (a.startsWith("--host=")) out.host = a.slice(7);
  }
  return out;
}
const cli = parseCliArgs(process.argv.slice(2));
if (cli.help) {
  console.log(
    `Héstia Console\n\nUso: node hestia.js [--port <n>] [--host <h>]\n` +
      `Também aceita HESTIA_PORT / HESTIA_HOST via env.\nPadrão: 127.0.0.1:4517`,
  );
  process.exit(0);
}
if (cli.port && Number.isFinite(cli.port)) config.port = cli.port;
if (cli.host) config.host = cli.host;

// Por padrão a Chama Local recusa expor a API fora do host local: evita que
// alguém acidentalmente vaze hostname/paths/serviços/logs para a LAN inteira
// sem autenticação. Quem quiser LAN de propósito (ex.: atrás de Tailscale)
// precisa admitir isso explicitamente via env.
if (!isLoopbackHost(config.host) && process.env.HESTIA_ALLOW_LAN !== "1") {
  console.error(
    `[Héstia] host "${config.host}" não é loopback (127.0.0.1/localhost).\n` +
      `Por padrão a Chama Local recusa iniciar fora do host local, pois a API não tem autenticação.\n` +
      `Se isso é intencional (ex.: rede já protegida por Tailscale/firewall), rode novamente com HESTIA_ALLOW_LAN=1.`,
  );
  process.exit(1);
}

// Diretório de dados persistentes (identidade, eventos, snapshots) — se não
// conseguir criar (ex.: permissão), segue no ar: saúde/services
// continuam funcionando, só as rotas de presence que dependem de disco
// degradam graciosamente (ver chama/presence.js).
try {
  ensureDataDir(config.dataDir);
  // Snapshot cíclico: gravado a cada SNAPSHOT_INTERVAL_MS; evento só se houver transição de serviço
  setInterval(() => runSnapshotCycle(config.dataDir), SNAPSHOT_INTERVAL_MS).unref();
  // Expurgo diário de planos/execuções/eventos antigos (ver chama/retention.js).
  const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  setInterval(
    () => sweepOldData(config.dataDir, config.retention),
    RETENTION_SWEEP_INTERVAL_MS,
  ).unref();
} catch (err) {
  log("warn", `Não foi possível preparar dataDir "${config.dataDir}": ${err.message}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false });

// Nunca vazar stack traces, mas devolver contexto útil para diagnóstico rápido.
app.setErrorHandler((err, req, reply) => {
  const code = err.code || err.name || "InternalError";
  const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const detail = err.message || "erro sem mensagem";
  log("error", `${req.method} ${req.url} → ${code}: ${detail}`);
  reply.code(status).send({
    ok: false,
    error: "Erro na Chama Local",
    code,
    detail,
    route: `${req.method} ${req.url}`,
    hint:
      code === "ENOENT"
        ? "Caminho/binário ausente no host (ex.: df, systemctl)."
        : code === "EACCES" || code === "EPERM"
          ? "Permissão negada — verifique se o usuário tem acesso ao recurso."
          : code === "ETIMEDOUT"
            ? "Tempo esgotado ao consultar o SO."
            : "Consulte o /logs do Héstia para o traço completo.",
    at: new Date().toISOString(),
  });
});

// --- Anti DNS-rebinding: só aceita Host headers que apontem para este bind. -
const allowedHosts = buildAllowedHosts(config.host, config.port, config.allowedHosts);
app.addHook("onRequest", async (req, reply) => {
  if (req.headers["x-forwarded-host"]) {
    log("warn", `X-Forwarded-Host detectado e rejeitado: "${req.headers["x-forwarded-host"]}"`);
    reply.code(421).send({
      ok: false,
      error: "Proxy header não permitido",
      code: "EBADHOST",
      detail: "O cabeçalho X-Forwarded-Host não é permitido nesta estação.",
      at: new Date().toISOString(),
    });
    return;
  }
  if (isAllowedHostHeader(req.headers.host, allowedHosts)) return;
  log("warn", `Host não permitido: "${req.headers.host ?? ""}" — ${req.method} ${req.url}`);
  reply.code(421).send({
    ok: false,
    error: "Host não permitido",
    code: "EBADHOST",
    detail: `Header Host "${req.headers.host ?? ""}" não corresponde a ${config.host}:${config.port}.`,
    hint: "Acesse pela URL local (ex.: http://localhost:4517). Proteção contra DNS rebinding.",
    at: new Date().toISOString(),
  });
});

// --- Rate limit simples para /api/* — evita martelamento acidental/abusivo. -
const apiRateLimiter = new RateLimiter({
  windowMs: 10_000,
  max: Number(process.env.HESTIA_RATE_LIMIT_MAX) || (process.env.NODE_ENV === "test" ? 500 : 200),
});
setInterval(() => apiRateLimiter.sweep(), 60_000).unref();
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  const { allowed, retryAfterMs } = apiRateLimiter.check(req.ip);
  if (allowed) return;
  reply.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  reply.code(429).send({
    ok: false,
    error: "Muitas requisições",
    code: "ERATELIMIT",
    detail: `Limite de ${apiRateLimiter.max} requisições por ${apiRateLimiter.windowMs / 1000}s excedido.`,
    at: new Date().toISOString(),
  });
});

// --- CORS opt-in só para /api/codice/* (Códice Web App). --------
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/codice/")) return;
  applyCodiceCors(req, reply, config.codiceCorsOrigin);
  if (req.method === "OPTIONS") return reply.code(204).send();
});

// --- CORS opt-in só para /api/presence/* (Presence pública, outra origem). --
// Nunca cobre /api/local/* nem o resto de /api/* — a proteção do header de confirmação de
// escrita depende justamente de não ter CORS habilitado ali (ver hook acima). Desligado por
// padrão (config.presenceCorsOrigins vazio); só liga com HESTIA_PRESENCE_CORS_ORIGIN explícito.
app.addHook("onRequest", async (req, reply) => {
  if (req.method !== "OPTIONS" || !req.url.startsWith("/api/presence/")) return;
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, config.presenceCorsOrigins)) return;
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "GET");
  if (req.headers["access-control-request-private-network"] === "true") {
    reply.header("Access-Control-Allow-Private-Network", "true");
  }
  reply.code(204).send();
});

// --- Headers de segurança em toda resposta. --------------------------------
// script-src precisa de 'unsafe-inline': o bundle SSR do TanStack Start
// injeta um script inline de hidratação (sem isso o React nunca hidrata e a
// UI fica travada em "Invariant failed"). Aceitável aqui: não há dado de
// usuário renderizado sem escape em lugar nenhum do app (sem
// dangerouslySetInnerHTML com conteúdo externo, sem inputs persistidos).
const CSP =
  "default-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  reply.header("Content-Security-Policy", CSP);
  if (req.url.startsWith("/api/codice/")) {
    applyCodiceCors(req, reply, config.codiceCorsOrigin);
  }
  if (req.url.startsWith("/api/presence/")) {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin, config.presenceCorsOrigins)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
  }
  return payload;
});

app.get("/api/health", async () => getHealth());

app.get("/api/server/status", async () => getServerStatus());
app.get("/api/storage/status", async () => await getStorageStatus());
app.get("/api/storage/discover", async () => await discoverVolumes());
app.get("/api/storage/model", async () => getStorageModel());
app.get("/api/storage/sources", async () => ({ items: config.storageSources }));
app.get("/api/storage/scan", async () => ({
  kaline: await scanStorageModel(),
  sources: await scanConfiguredSources(),
}));
app.get("/api/hardware/status", async () => await getHardwareStatus());
app.get("/api/hardware/config", async () => await getHardwareConfig());
app.get("/api/services/status", async () => await getServicesStatus());
app.get("/api/services/bindings", async () => getServiceBindings());
app.get("/api/logs", async (req) => {
  const raw = Number(req.query?.tail);
  const tail = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 100;
  return getLogs(tail);
});

registerStationRoutes(app);

app.get("/api/config", async () => ({
  appName: config.appName,
  serverName: config.serverName,
  agentName: config.agentName,
  version: config.version,
  host: config.host,
  port: config.port,
  mode: config.mode,
  readonly: config.readonly,
  controlledWrites: config.controlledWrites,
  lanEnabled: config.lanEnabled,
  ...publicStationConfig(),
  services: config.services,
}));

// --- Rotas do Códice (Leitura restrita) -------------------------------------
registerCodiceRoutes(app, config);

// --- Rotas de Presence (read-only): consulta same-origin/local --------
app.get(
  "/api/presence/manifest",
  presenceRoute(() => getManifest()),
);
app.get(
  "/api/presence/summary",
  presenceRoute(async () => await getPresenceSummary(config.dataDir)),
);
app.get(
  "/api/presence/health",
  presenceRoute(() => getHealth()),
);
app.get(
  "/api/presence/events/recent",
  presenceRoute(async (req) => {
    const raw = Number(req.query?.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 100;
    const events = await getRecentEvents({ limit }, config.dataDir);
    return { events, limit };
  }),
);
app.get(
  "/api/presence/snapshots/latest",
  presenceRoute(async () => await getLatestSnapshot(config.dataDir)),
);
app.get(
  "/api/presence/services",
  presenceRoute(async () => await getServicesStatus()),
);
app.get(
  "/api/presence/storage",
  presenceRoute(async () => await getStorageStatus()),
);
app.get(
  "/api/presence/backups",
  presenceRoute(() => getBackupsPlan()),
);
app.get(
  "/api/presence/capabilities",
  presenceRoute(() => getCapabilities()),
);

// Servir o frontend buildado quando existir (build output do TanStack Start).
// O build é SSR (bundle Nitro no formato Cloudflare Workers module, não uma
// SPA estática com index.html) — estáticos vêm de `publicDir` via
// @fastify/static, e o que não bater em nenhum arquivo cai no bundle SSR
// (`serverEntry`), que roda sob Node puro (veja chama/ssr.js).
function firstExisting(paths) {
  return paths.find((p) => existsSync(p));
}

const serverEntryCandidates = [
  join(__dirname, "dist", "server", "index.mjs"),
  join(__dirname, "dist", "server", "server.js"),
  join(__dirname, ".output", "server", "index.mjs"),
];
const buildTargets = [
  {
    publicDir: join(__dirname, "dist", "client"),
    serverEntry: firstExisting(serverEntryCandidates),
  },
  {
    publicDir: join(__dirname, ".output", "public"),
    serverEntry: firstExisting(serverEntryCandidates),
  },
];
const build = buildTargets.find((b) => existsSync(b.publicDir));
if (build) {
  await app.register(fastifyStatic, { root: build.publicDir, prefix: "/" });
  if (build.serverEntry) {
    const ssrFetch = createSsrFetcher(build.serverEntry);
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({
          ok: false,
          error: "não encontrado",
        });
      }
      try {
        const ssrRes = await ssrFetch(req);
        reply.code(ssrRes.status);
        copyResponseHeaders(ssrRes, reply);
        reply.send(Buffer.from(await ssrRes.arrayBuffer()));
      } catch (err) {
        log("error", `SSR fallback falhou em ${req.method} ${req.url}: ${err.message}`);
        reply.code(500).send({
          ok: false,
          error: "Erro ao renderizar a interface",
          code: err.code || "ESSR",
          detail: err.message,
        });
      }
    });
  } else {
    log(
      "warn",
      `bundle SSR não encontrado — caminhos testados: ${serverEntryCandidates.join(", ")}`,
    );
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ ok: false, error: "não encontrado" });
        return;
      }
      reply.code(404).send({
        ok: false,
        error: "Interface não encontrada",
        hint: "Rode npm run build e reinicie hestia-console",
        checkedPaths: serverEntryCandidates,
      });
    });
  }
} else {
  log("warn", "frontend buildado não encontrado — rode npm run build antes de iniciar a Héstia");
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.code(404).send({ ok: false, error: "não encontrado" });
      return;
    }
    reply.code(404).send({
      ok: false,
      error: "Interface não encontrada",
      hint: "Rode npm run build e reinicie hestia-console",
      checkedPaths: serverEntryCandidates,
    });
  });
}

log("info", `Chama Local iniciando em ${config.host}:${config.port}`);
try {
  await app.listen({ host: config.host, port: config.port });
  log("info", `Héstia Console disponível em http://${config.host}:${config.port}`);
  console.log(`[Héstia] pronto em http://${config.host}:${config.port}`);
} catch (err) {
  log("error", `falha ao iniciar: ${err.message}`);
  console.error(err);
  process.exit(1);
}
