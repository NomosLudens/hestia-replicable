// Chama Local — validações de segurança na borda HTTP.
// Host allowlist (mitiga DNS rebinding contra a API local) + rate limit
// simples em memória para /api/*. Nada aqui depende de rede ou de Fastify,
// para ficar testável isoladamente.

export function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

// Host headers aceitos para host:port configurados. Quando o bind é loopback,
// aceitamos também os aliases usuais (127.0.0.1, localhost, [::1]) no mesmo
// porto, já que todos apontam para a própria máquina.
export function buildAllowedHosts(host, port, extraHostsRaw = "") {
  const allowed = new Set([`${host}:${port}`]);
  if (isLoopbackHost(host)) {
    allowed.add(`127.0.0.1:${port}`);
    allowed.add(`localhost:${port}`);
    allowed.add(`[::1]:${port}`);
    allowed.add("127.0.0.1");
    allowed.add("localhost");
    allowed.add("[::1]");
  }
  if (extraHostsRaw && typeof extraHostsRaw === "string") {
    const extra = extraHostsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const e of extra) {
      if (e.includes("*")) continue; // Rejeitar wildcards
      allowed.add(e);
    }
  }
  return allowed;
}

export function isAllowedHostHeader(hostHeader, allowedHosts) {
  return typeof hostHeader === "string" && allowedHosts.has(hostHeader);
}

// CORS pra Presence é opt-in explícito, nunca ligado por padrão. HESTIA_PRESENCE_CORS_ORIGIN
// aceita uma lista separada por vírgula ("https://presence.example, https://outra.com") ou "*"
// (qualquer origem) — vazio/ausente preserva o comportamento restritivo de sempre.
export function resolvePresenceCorsOrigins(env = process.env) {
  const raw = env.HESTIA_PRESENCE_CORS_ORIGIN;
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin || allowedOrigins.length === 0) return false;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

// Janela fixa por chave (IP). Suficiente para uma API local somente leitura
// que só precisa impedir martelamento acidental ou abusivo.
export class RateLimiter {
  constructor({ windowMs = 10_000, max = 60 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  check(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    const allowed = entry.count <= this.max;
    return { allowed, retryAfterMs: allowed ? 0 : entry.resetAt - now };
  }

  // Remove entradas expiradas para não crescer sem limite em processos de longa duração.
  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (now > entry.resetAt) this.hits.delete(key);
    }
  }
}

export function applyCodiceCors(req, reply, allowedOrigin, options = {}) {
  if (!allowedOrigin) return false;

  const reqOrigin = req.headers.origin;
  if (!reqOrigin) return false;

  // Por segurança absoluta, rejeitamos wildcard "*" no CORS da biblioteca Códice
  const isAllowed = allowedOrigin
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "*")
    .includes(reqOrigin);
  if (!isAllowed) return false;

  reply.header("Access-Control-Allow-Origin", reqOrigin);
  const vary = String((typeof reply.getHeader === "function" ? reply.getHeader("Vary") : "") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === "origin")) vary.push("Origin");
  reply.header("Vary", vary.join(", "));
  reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (options.allowCredentials !== false) {
    reply.header("Access-Control-Allow-Credentials", "true");
  }

  if (req.headers["access-control-request-private-network"] === "true") {
    reply.header("Access-Control-Allow-Private-Network", "true");
  }
  return true;
}
