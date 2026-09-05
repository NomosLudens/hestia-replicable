import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

export const STATION_CODES = Object.freeze({
  NOT_CONFIGURED: "STATION_NOT_CONFIGURED",
  MISCONFIGURED: "STATION_MISCONFIGURED",
  TIMEOUT: "STATION_TIMEOUT",
  UNAVAILABLE: "STATION_UNAVAILABLE",
  AUTH_FAILED: "STATION_AUTH_FAILED",
  REDIRECT_REJECTED: "STATION_REDIRECT_REJECTED",
  INVALID_CONTENT_TYPE: "STATION_INVALID_CONTENT_TYPE",
  RESPONSE_TOO_LARGE: "STATION_RESPONSE_TOO_LARGE",
  CONTRACT_MISMATCH: "STATION_CONTRACT_MISMATCH",
});

export const STATION_IDS = Object.freeze([
  "desktop",
  "tvbox",
  "pocket",
  "baby",
  "mini",
  "max",
  "note",
  "kaos",
]);
const STATION_ENV = Object.freeze({
  desktop: ["HESTIA_DESKTOP_BASE_URL", "HESTIA_DESKTOP_TOKEN"],
  tvbox: ["HESTIA_TVBOX_BASE_URL", "HESTIA_TVBOX_TOKEN"],
  pocket: ["HESTIA_POCKET_BASE_URL", "HESTIA_POCKET_TOKEN"],
  baby: ["HESTIA_BABY_BASE_URL", "HESTIA_BABY_TOKEN"],
  mini: ["HESTIA_MINI_BASE_URL", "HESTIA_MINI_TOKEN"],
  max: ["HESTIA_MAX_BASE_URL", "HESTIA_MAX_TOKEN"],
  note: ["HESTIA_NOTE_BASE_URL", "HESTIA_NOTE_TOKEN"],
  kaos: ["HESTIA_KAOS_BASE_URL", "HESTIA_KAOS_TOKEN"],
});
const LEGACY_KEYS = Object.freeze(["HESTIA_STATION_BASE_URL", "HESTIA_STATION_TOKEN"]);

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;
const HEALTH_PATH = "/api/station/health";
const STORAGE_PATH = "/api/station/storage/status";
const SERVICES_PATH = "/api/station/services/status";
const SERVICES_REPORT_PATH = "/api/station/services/report";
const SYSTEM_PATH = "/api/station/system/status";
const UPDATES_PATH = "/api/station/updates";
const APPS_PATH = "/api/station/apps";
const TUNNEL_PATH = "/api/station/tunnel/status";
const CODICE_HEALTH_PATH = "/api/station/codice/health";
const MAX_BODY_BYTES = 64 * 1024;
// /api/station/services/report devolve o inventário completo do systemd do
// host (centenas de unidades × ~16 propriedades). Reserva-se 4 MB — ainda
// bastante folgado para qualquer host realista.
const MAX_BODY_BYTES_REPORT = 4 * 1024 * 1024;
// O report precisa de um timeout maior (systemctl show é lento em hosts com
// 200+ unidades). 25s é o que o Console já usa para /updates; mantemos.
const REPORT_TIMEOUT_MS = 25000;
const MIN_REPORT_TIMEOUT_MS = 1000;
const MAX_REPORT_TIMEOUT_MS = 60000;
const SERVICE = "hestia-station-agent";
const STORAGE_STATUSES = new Set(["ok", "missing", "unavailable"]);
// Budget dedicado para /api/station/updates: apt-get -s upgrade medido em
// ~14s na TV Box (ARMv7, Debian/Armbian). O Station Agent usa 20s internamente;
// a Console concede 25s para acomodar a latência de rede e margem de segurança.
// Fast routes (health, storage, services, system, tunnel, codice) permanecem em DEFAULT_TIMEOUT_MS.
const UPDATES_CONSOLE_TIMEOUT_MS = 25000;
const UPDATES_CONSOLE_MIN_TIMEOUT_MS = 1000;
const UPDATES_CONSOLE_MAX_TIMEOUT_MS = 60000;
const SERVICE_STATUSES = new Set([
  "active",
  "inactive",
  "failed",
  "not-installed",
  "unavailable",
  "unknown",
]);
const ALLOWED_SERVICES = ["jellyfin", "smbd", "tailscaled", "telegram-guard"];

function resolveTimeout(raw = process.env.HESTIA_STATION_TIMEOUT_MS) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) return DEFAULT_TIMEOUT_MS;
  return n;
}

function isLoopback(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isDevelopmentLike(env = process.env.NODE_ENV) {
  return env === "development" || env === "test";
}

function allowsExplicitLoopbackHttp(env) {
  return env.HESTIA_STATION_ALLOW_HTTP_LOOPBACK === "1";
}

export function hasLegacyStationConfig(env = process.env) {
  return LEGACY_KEYS.some((key) => typeof env[key] === "string" && env[key].trim() !== "");
}

export function resolveNamedStationConfig(stationId, env = process.env) {
  const names = STATION_ENV[stationId];
  if (!names) throw new TypeError(`Station desconhecida: ${stationId}`);
  const [baseUrlKey, tokenKey] = names;
  const rawBaseUrl = env[baseUrlKey]?.trim() || "";
  const rawToken = env[tokenKey]?.trim() || "";
  const timeoutMs = resolveTimeout(env.HESTIA_STATION_TIMEOUT_MS);
  if (!rawBaseUrl && !rawToken) {
    return {
      stationId,
      configured: false,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.NOT_CONFIGURED,
    };
  }

  if (!rawBaseUrl || !rawToken) {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }

  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }

  // Validate the raw pathname BEFORE trusting URL parsing (URL() silently
  // strips traversal sequences and percent-decodes escapes).
  if (!isSafePathname(rawBaseUrl)) {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }

  if (baseUrl.username || baseUrl.password || baseUrl.search !== "" || baseUrl.hash !== "") {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }
  const protocolAllowed =
    baseUrl.protocol === "https:" ||
    (baseUrl.protocol === "http:" &&
      isLoopback(baseUrl.hostname) &&
      (isDevelopmentLike(env.NODE_ENV) || allowsExplicitLoopbackHttp(env)));
  if (!protocolAllowed) {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }
  const normalizedBasePath = normalizeBasePath(baseUrl.pathname);
  if (!normalizedBasePath.ok) {
    return {
      stationId,
      configured: true,
      valid: false,
      baseUrl: null,
      token: null,
      timeoutMs,
      errorCode: STATION_CODES.MISCONFIGURED,
    };
  }

  const normalized = new URL(baseUrl.origin);
  normalized._basePath = normalizedBasePath.path;
  return {
    stationId,
    configured: true,
    valid: true,
    baseUrl: normalized,
    token: rawToken,
    timeoutMs,
    errorCode: null,
  };
}

/**
 * Check the raw input URL string for unsafe characters in its pathname.
 *
 * URL() normalizes traversal and decodes escapes silently, so we must
 * inspect the raw input. Catches:
 *   - ".." or "." as full segment (traversal / unsafe root reference)
 *   - "%2e"/"%2E" (encoded dot)
 *   - "%2f"/"%2F" (encoded slash)
 *   - backslash, null, control chars
 *   - query / fragment leakage past `?` or `#`
 *   - credentials ("@" before the host)
 *   - double slash unsafe paths ("//host")
 */
export function isSafePathname(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;
  // Reject control / backslash / null bytes anywhere.
  if (/[\x00-\x1f\\]/.test(rawUrl)) return false;
  // Locate authority end: "scheme://userinfo@host:port" then path.
  // Find first occurrence of "://" then next "/".
  const schemeIdx = rawUrl.indexOf("://");
  if (schemeIdx < 0) return false;
  let pathStart = rawUrl.indexOf("/", schemeIdx + 3);
  if (pathStart < 0) {
    // No path at all — ok (root base URL).
    return true;
  }
  const rawPath = rawUrl.slice(pathStart);
  // No "?" or "#" should appear in the base URL (defensive — caught earlier too).
  if (/[?#]/.test(rawPath)) return false;
  // No double slash unsafe path: "//host" anywhere in the path.
  // (A single leading "/" is fine.)
  if (rawPath.includes("//")) return false;
  // Reject encoded dot or slash (case-insensitive).
  if (/%2[eE]/.test(rawPath) || /%2[fF]/.test(rawPath)) return false;
  // Reject double-encoded variants ("%252e%252e").
  if (/%252[eE]/.test(rawPath) || /%252[fF]/.test(rawPath)) return false;
  // Split on "/" and reject "." or ".." segments.
  const segs = rawPath.split("/").slice(1);
  for (const seg of segs) {
    if (seg === "." || seg === "..") return false;
  }
  return true;
}

/**
 * Normalize and validate the configured Station base path.
 *
 * Accepts "/" (root) or a single absolute path segment like "/station".
 * Rejects:
 *  - empty / non-string
 *  - missing leading slash (or non-root without one)
 *  - "." or ".." segments (after percent-decoding)
 *  - ".." encoded (%2e%2e) or double-encoded (%252e%252e)
 *  - any segment containing "/" mid-segment (encoded traversal)
 *  - query / fragment (already filtered earlier, defensive)
 *  - multi-segment paths beyond a single level, e.g. "/foo/bar"
 *  - backslashes or null bytes
 *  - "..", ".", "" segments anywhere
 *  - double-slash unsafe paths ("/foo//bar")
 *  - any resolution that escapes the configured base path
 *
 * Returns { ok: true, path } or { ok: false }.
 */
export function normalizeBasePath(rawPathname) {
  if (typeof rawPathname !== "string") return { ok: false };
  if (rawPathname === "") return { ok: true, path: "" };
  if (!rawPathname.startsWith("/")) return { ok: false };
  // Reject backslashes, null bytes, control chars, fragment/query leakage.
  if (/[\\\x00\x01-\x1f#?]/.test(rawPathname)) return { ok: false };

  // Decode once to catch "%2e%2e" etc.
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return { ok: false };
  }
  // Re-decode to defeat double-encoding ("%252e%252e" → "%2e%2e" → "..").
  try {
    const doubleDecoded = decodeURIComponent(decoded);
    if (doubleDecoded !== decoded) return { ok: false };
  } catch {
    return { ok: false };
  }
  if (/[\\\x00\x01-\x1f]/.test(decoded)) return { ok: false };

  // Split into segments and validate each.
  // "/" or "" → [""]", ""], slice(1) → [""], treated as root.
  const rawSegments = decoded.split("/");
  const segments = rawSegments.slice(1).filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: true, path: "" };
  // Reject root-anchored multi-segment base paths to keep this scoped.
  // Only single-segment mount points like "/station" are accepted.
  if (segments.length > 1) return { ok: false };
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return { ok: false };
    if (seg.includes("/")) return { ok: false };
    // Reject percent-encoded characters in the segment body.
    if (/%/.test(seg)) return { ok: false };
  }
  return { ok: true, path: "/" + segments.join("/") };
}

/**
 * Safely join a configured Station base URL with a resource path.
 *
 * baseUrl is the validated URL produced by resolveNamedStationConfig (origin
 * preserved, pathname either "/" or "/<single-segment>"). resourcePath must
 * be an absolute path beginning with "/" and is appended verbatim after the
 * base path; exactly one slash is enforced at the join boundary.
 *
 * Returns { ok: true, url, pathname } or { ok: false }.
 *
 * The resulting URL MUST:
 *  - share the origin of the configured base URL (no cross-origin escape)
 *  - have a pathname that begins with the configured base path
 *  - have no query / fragment / credentials (defensive)
 */
export function joinStationResourcePath(baseUrl, resourcePath) {
  if (!(baseUrl instanceof URL)) return { ok: false };
  if (typeof resourcePath !== "string") return { ok: false };
  if (!resourcePath.startsWith("/")) return { ok: false };
  if (/[\\\x00\x01-\x1f#?]/.test(resourcePath)) return { ok: false };
  const basePath = typeof baseUrl._basePath === "string" ? baseUrl._basePath : "";
  // Compute joined pathname: basePath + resourcePath with single '/' boundary.
  let joined;
  if (basePath === "") {
    joined = resourcePath;
  } else {
    if (resourcePath === "/" || resourcePath === "") {
      joined = basePath;
    } else {
      joined = basePath + resourcePath;
    }
  }
  // Verify joined does not contain double slashes or traversal sequences.
  if (joined.includes("//")) return { ok: false };
  // Decode + re-check for encoded traversal that survived parsing.
  let decodedJoined;
  try {
    decodedJoined = decodeURIComponent(joined);
  } catch {
    return { ok: false };
  }
  if (decodedJoined.includes("//")) return { ok: false };
  // Reject any ".." segment anywhere in joined path (after decoding).
  const decodedSegments = decodedJoined.split("/");
  for (const seg of decodedSegments) {
    if (seg === "..") return { ok: false };
    if (seg === ".") return { ok: false };
  }
  // Final guard: joined MUST start with basePath.
  if (!joined.startsWith(basePath === "" ? "/" : basePath)) {
    // For basePath="" the joined path must start with "/".
    return { ok: false };
  }
  // Reconstruct URL preserving origin.
  const finalUrl = new URL(joined, baseUrl.origin);
  if (finalUrl.origin !== baseUrl.origin) return { ok: false };
  if (finalUrl.username || finalUrl.password || finalUrl.search !== "" || finalUrl.hash !== "") {
    return { ok: false };
  }
  return { ok: true, url: finalUrl, pathname: finalUrl.pathname };
}

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function validateStationHealth(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok !== true) return null;
  if (body.schemaVersion !== 1) return null;
  if (body.service !== SERVICE) return null;
  if (typeof body.version !== "string" || body.version.trim() === "") return null;
  if (!isValidIsoDate(body.checkedAt)) return null;
  return {
    ok: true,
    schemaVersion: 1,
    service: SERVICE,
    version: body.version,
    checkedAt: body.checkedAt,
  };
}

function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function validNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateStationStorage(body) {
  if (!isPlainObject(body) || !hasExactKeys(body, ["ok", "schemaVersion", "checkedAt", "storage"]))
    return null;
  const item = body.storage;
  if (body.ok !== true || body.schemaVersion !== 1 || !isValidIsoDate(body.checkedAt)) return null;
  if (
    !isPlainObject(item) ||
    !hasExactKeys(item, [
      "id",
      "exists",
      "status",
      "totalBytes",
      "usedBytes",
      "freeBytes",
      "percentUsed",
    ]) ||
    item.id !== "kaline" ||
    typeof item.exists !== "boolean" ||
    !STORAGE_STATUSES.has(item.status)
  )
    return null;
  const values = [item.totalBytes, item.usedBytes, item.freeBytes];
  if (item.status === "ok") {
    if (!item.exists || !values.every(validNonNegativeNumber)) return null;
    if (!validNonNegativeNumber(item.percentUsed) || item.percentUsed > 100) return null;
  } else if (values.some((value) => value !== null) || item.percentUsed !== null) return null;
  if (item.status === "missing" && item.exists) return null;
  return {
    ok: true,
    schemaVersion: 1,
    checkedAt: body.checkedAt,
    storage: {
      id: "kaline",
      exists: item.exists,
      status: item.status,
      totalBytes: item.totalBytes,
      usedBytes: item.usedBytes,
      freeBytes: item.freeBytes,
      percentUsed: item.percentUsed,
    },
  };
}

function validateStationServices(body) {
  if (!isPlainObject(body) || !hasExactKeys(body, ["ok", "schemaVersion", "checkedAt", "services"]))
    return null;
  if (
    body.ok !== true ||
    body.schemaVersion !== 1 ||
    !isValidIsoDate(body.checkedAt) ||
    !Array.isArray(body.services)
  )
    return null;
  const seen = new Set();
  const services = [];
  for (const item of body.services) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, ["id", "active", "status"]) ||
      !ALLOWED_SERVICES.includes(item.id) ||
      seen.has(item.id) ||
      typeof item.active !== "boolean" ||
      !SERVICE_STATUSES.has(item.status) ||
      item.active !== (item.status === "active")
    )
      return null;
    seen.add(item.id);
    services.push({ id: item.id, active: item.active, status: item.status });
  }
  if (
    services.some(
      (item, index) =>
        ALLOWED_SERVICES.indexOf(item.id) <= ALLOWED_SERVICES.indexOf(services[index - 1]?.id),
    )
  )
    return null;
  return { ok: true, schemaVersion: 1, checkedAt: body.checkedAt, services };
}

function validPercent(value) {
  return validNonNegativeNumber(value) && value <= 100;
}

function validateByteGroup(item) {
  if (
    !isPlainObject(item) ||
    !hasExactKeys(item, ["totalBytes", "usedBytes", "freeBytes", "usedPercent"]) ||
    ![item.totalBytes, item.usedBytes, item.freeBytes].every(validNonNegativeNumber) ||
    !validPercent(item.usedPercent)
  )
    return null;
  if (item.usedBytes + item.freeBytes > item.totalBytes) return null;
  return {
    totalBytes: item.totalBytes,
    usedBytes: item.usedBytes,
    freeBytes: item.freeBytes,
    usedPercent: item.usedPercent,
  };
}

function validateStationSystem(body) {
  if (!isPlainObject(body) || !hasExactKeys(body, ["ok", "schemaVersion", "checkedAt", "system"]))
    return null;
  if (body.ok !== true || body.schemaVersion !== 1 || !isValidIsoDate(body.checkedAt)) return null;
  const system = body.system;
  if (
    !isPlainObject(system) ||
    !hasExactKeys(system, [
      "hostname",
      "platform",
      "release",
      "arch",
      "uptimeSeconds",
      "cpu",
      "memory",
      "swap",
      "rootDisk",
    ]) ||
    typeof system.hostname !== "string" ||
    system.hostname.trim() === "" ||
    typeof system.platform !== "string" ||
    typeof system.release !== "string" ||
    typeof system.arch !== "string" ||
    !validNonNegativeNumber(system.uptimeSeconds)
  )
    return null;
  const cpu = system.cpu;
  if (
    !isPlainObject(cpu) ||
    !hasExactKeys(cpu, ["model", "cores", "threads", "loadAverage", "usagePercent"]) ||
    typeof cpu.model !== "string" ||
    !Number.isInteger(cpu.cores) ||
    cpu.cores < 1 ||
    !Number.isInteger(cpu.threads) ||
    cpu.threads < 1 ||
    !Array.isArray(cpu.loadAverage) ||
    cpu.loadAverage.length !== 3 ||
    !cpu.loadAverage.every(validNonNegativeNumber) ||
    !(validPercent(cpu.usagePercent) || cpu.usagePercent === null)
  )
    return null;
  const memory = validateByteGroup(system.memory);
  const swap = validateByteGroup(system.swap);
  const rootDisk = validateByteGroup(system.rootDisk);
  if (!memory || !swap || !rootDisk) return null;
  return {
    ok: true,
    schemaVersion: 1,
    checkedAt: body.checkedAt,
    system: {
      hostname: system.hostname,
      platform: system.platform,
      release: system.release,
      arch: system.arch,
      uptimeSeconds: system.uptimeSeconds,
      cpu: {
        model: cpu.model,
        cores: cpu.cores,
        threads: cpu.threads,
        loadAverage: cpu.loadAverage,
        usagePercent: cpu.usagePercent,
      },
      memory,
      swap,
      rootDisk,
    },
  };
}

function validateStationUpdates(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok === false && body.status === "unsupported") {
    return {
      ok: false,
      status: "unsupported",
      reason: typeof body.reason === "string" ? body.reason : "APT_NOT_AVAILABLE",
      checkedAt: isValidIsoDate(body.checkedAt) ? body.checkedAt : new Date().toISOString(),
    };
  }
  if (body.ok === false && body.status === "error") {
    return {
      ok: false,
      status: "error",
      reason: typeof body.reason === "string" ? body.reason : "APT_EXEC_FAILED",
      checkedAt: isValidIsoDate(body.checkedAt) ? body.checkedAt : new Date().toISOString(),
    };
  }
  if (
    body.ok !== true ||
    body.schemaVersion !== 1 ||
    body.status !== "ok" ||
    !isValidIsoDate(body.checkedAt) ||
    !Array.isArray(body.updates) ||
    !Number.isInteger(body.totalUpdates) ||
    typeof body.rebootRequired !== "boolean"
  ) {
    return null;
  }
  const updates = [];
  for (const item of body.updates) {
    if (
      !isPlainObject(item) ||
      typeof item.package !== "string" ||
      !item.package.trim() ||
      typeof item.installedVersion !== "string" ||
      typeof item.candidateVersion !== "string" ||
      !(item.security === true || item.security === null)
    ) {
      return null;
    }
    updates.push({
      package: item.package,
      installedVersion: item.installedVersion,
      candidateVersion: item.candidateVersion,
      security: item.security,
    });
  }
  return {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: body.checkedAt,
    updates,
    totalUpdates: body.totalUpdates,
    securityUpdates:
      typeof body.securityUpdates === "number"
        ? body.securityUpdates
        : updates.filter((item) => item.security === true).length,
    rebootRequired: body.rebootRequired,
  };
}

function validateStationTunnel(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok !== true || body.schemaVersion !== 1 || !isValidIsoDate(body.checkedAt)) {
    return null;
  }
  if (!isPlainObject(body.tunnel) || !isPlainObject(body.publicRoute)) {
    return null;
  }
  return {
    ok: true,
    schemaVersion: 1,
    status: typeof body.status === "string" ? body.status : "ok",
    checkedAt: body.checkedAt,
    tunnel: {
      name: typeof body.tunnel.name === "string" ? body.tunnel.name : "cloudflared",
      connected: Boolean(body.tunnel.connected),
      haConnections: Number.isInteger(body.tunnel.haConnections) ? body.tunnel.haConnections : 0,
      protocol: typeof body.tunnel.protocol === "string" ? body.tunnel.protocol : "unknown",
      edgeColo: typeof body.tunnel.edgeColo === "string" ? body.tunnel.edgeColo : null,
    },
    publicRoute: {
      hostname: typeof body.publicRoute.hostname === "string" ? body.publicRoute.hostname : null,
      status:
        typeof body.publicRoute.status === "string" ? body.publicRoute.status : "not_configured",
      httpStatus: Number.isInteger(body.publicRoute.httpStatus)
        ? body.publicRoute.httpStatus
        : null,
      latencyMs: Number.isInteger(body.publicRoute.latencyMs) ? body.publicRoute.latencyMs : null,
      checkedAt: isValidIsoDate(body.publicRoute.checkedAt)
        ? body.publicRoute.checkedAt
        : body.checkedAt,
    },
  };
}

function validateCodiceHealth(body) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(body, ["ok", "schemaVersion", "generatedAt", "libraryAvailable", "formats"]) ||
    body.ok !== true ||
    body.schemaVersion !== 1 ||
    body.libraryAvailable !== true ||
    !isValidIsoDate(body.generatedAt) ||
    !Array.isArray(body.formats)
  )
    return null;
  const formats = [...new Set(body.formats)];
  if (
    formats.length !== body.formats.length ||
    formats.some((format) => !["epub", "pdf", "txt"].includes(format)) ||
    !formats.includes("epub") ||
    !formats.includes("pdf")
  )
    return null;
  return {
    ok: true,
    state: "available",
    libraryAvailable: true,
    formats,
    checkedAt: body.generatedAt,
  };
}

function isSafeString(value, { nonEmpty = false } = {}) {
  return (
    typeof value === "string" &&
    !/[\0-\x1F\x7F]/.test(value) &&
    (!nonEmpty || value.trim().length > 0)
  );
}

function isSafeNullableString(value) {
  return value === null || isSafeString(value);
}

function isJsonContentType(header) {
  const mediaType = String(header || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function declaredBodyTooLarge(header, maxBytes = MAX_BODY_BYTES) {
  if (!header) return false;
  const value = Number(header);
  return Number.isFinite(value) && value > maxBytes;
}

async function readLimitedJson(res, maxBytes = MAX_BODY_BYTES) {
  if (!isJsonContentType(res.headers.get("content-type"))) {
    return { ok: false, code: STATION_CODES.INVALID_CONTENT_TYPE };
  }
  if (declaredBodyTooLarge(res.headers.get("content-length"), maxBytes)) {
    return { ok: false, code: STATION_CODES.RESPONSE_TOO_LARGE };
  }
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, code: STATION_CODES.CONTRACT_MISMATCH };
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, code: STATION_CODES.RESPONSE_TOO_LARGE };
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, code: STATION_CODES.CONTRACT_MISMATCH };
  }
}

function failure(state, code, latencyMs = null) {
  return { ok: false, state, code, latencyMs, station: null, checkedAt: new Date().toISOString() };
}

export async function fetchStationHealth(stationConfig) {
  const result = await fetchStationResource(HEALTH_PATH, validateStationHealth, stationConfig);
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, station: resource };
}

async function fetchStationResource(
  path,
  validate,
  cfg,
  timeoutMs,
  method = "GET",
  bodyPayload = null,
  maxBytes = MAX_BODY_BYTES,
) {
  if (!cfg || typeof cfg !== "object") throw new TypeError("configuração da Station é obrigatória");
  if (!cfg.configured) return failure("not_configured", STATION_CODES.NOT_CONFIGURED);
  if (!cfg.valid) return failure("misconfigured", cfg.errorCode || STATION_CODES.MISCONFIGURED);

  const joined = joinStationResourcePath(cfg.baseUrl, path);
  if (!joined.ok) {
    return failure("misconfigured", STATION_CODES.MISCONFIGURED);
  }
  const finalUrl = joined.url;
  // Invariant: joined pathname must end with the absolute resource path.
  if (!joined.pathname.endsWith(path)) {
    return failure("misconfigured", STATION_CODES.MISCONFIGURED);
  }

  const effectiveTimeoutMs =
    Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : cfg.timeoutMs;
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${cfg.token}`,
      "X-Hestia-Console-Version": pkg.version || "0.1.0",
      "X-Hestia-Request-Id": randomUUID(),
    };
    if (bodyPayload) {
      headers["Content-Type"] = "application/json";
    }

    const fetchOpts = {
      method,
      headers,
      redirect: "manual",
      signal: controller.signal,
    };
    if (bodyPayload) {
      fetchOpts.body = JSON.stringify(bodyPayload);
    }

    const res = await fetch(finalUrl, fetchOpts);
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    if (res.status === 401 || res.status === 403)
      return failure("unauthorized", STATION_CODES.AUTH_FAILED);
    if (res.status >= 300 && res.status < 400)
      return failure("incompatible", STATION_CODES.REDIRECT_REJECTED);
    if (!res.ok) return failure("unavailable", STATION_CODES.UNAVAILABLE);
    const parsed = await readLimitedJson(res, maxBytes);
    if (!parsed.ok) return failure("incompatible", parsed.code);
    const resource = validate(parsed.body);
    if (!resource) return failure("incompatible", STATION_CODES.CONTRACT_MISMATCH);
    return {
      ok: true,
      state: "available",
      code: null,
      latencyMs,
      resource,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const isAbort =
      controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
    return failure("unavailable", isAbort ? STATION_CODES.TIMEOUT : STATION_CODES.UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTvboxCodiceHealth(stationConfig) {
  const cfg = stationConfig;
  if (!cfg || typeof cfg !== "object") throw new TypeError("configuração da TV Box é obrigatória");
  if (cfg.stationId !== "tvbox") return failure("misconfigured", STATION_CODES.MISCONFIGURED);
  if (!cfg.configured) return failure("not_configured", STATION_CODES.NOT_CONFIGURED);
  if (!cfg.valid) return failure("misconfigured", cfg.errorCode || STATION_CODES.MISCONFIGURED);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const codiceJoined = joinStationResourcePath(cfg.baseUrl, CODICE_HEALTH_PATH);
    if (!codiceJoined.ok) {
      return failure("misconfigured", STATION_CODES.MISCONFIGURED);
    }
    const response = await fetch(codiceJoined.url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${cfg.token}` },
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400)
      return failure("incompatible", STATION_CODES.REDIRECT_REJECTED);
    if (!response.ok) return failure("unavailable", STATION_CODES.UNAVAILABLE);
    const parsed = await readLimitedJson(response);
    if (!parsed.ok) return failure("incompatible", parsed.code);
    const codice = validateCodiceHealth(parsed.body);
    if (!codice) return failure("incompatible", STATION_CODES.CONTRACT_MISMATCH);
    return codice;
  } catch (error) {
    return failure(
      "unavailable",
      controller.signal.aborted ? STATION_CODES.TIMEOUT : STATION_CODES.UNAVAILABLE,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStationStorageStatus(stationConfig) {
  const result = await fetchStationResource(STORAGE_PATH, validateStationStorage, stationConfig);
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, storage: resource };
}

export async function fetchStationServicesStatus(stationConfig) {
  const result = await fetchStationResource(SERVICES_PATH, validateStationServices, stationConfig);
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, services: resource };
}

export function resolveReportTimeoutMs(env = process.env, fallback = REPORT_TIMEOUT_MS) {
  const raw = env.HESTIA_STATION_SERVICES_REPORT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_REPORT_TIMEOUT_MS || n > MAX_REPORT_TIMEOUT_MS) {
    return fallback;
  }
  return n;
}

function isValidIso(value) {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

const ACTIVE_STATES = new Set([
  "active",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "reloading",
  "maintenance",
  "unknown",
]);
const UNIT_FILE_STATES = new Set([
  "enabled",
  "disabled",
  "static",
  "masked",
  "generated",
  "transient",
  "bad",
  "indirect",
  "unknown",
]);

function validateReportService(item) {
  if (!isPlainObject(item) || typeof item.unit !== "string" || item.unit === "") return null;
  if (item.unit.includes("/") || item.unit.includes(" ") || item.unit.includes("\0")) return null;
  if (!item.unit.endsWith(".service")) return null;
  if (typeof item.description !== "string") return null;
  if (typeof item.loadState !== "string") return null;
  if (!ACTIVE_STATES.has(item.activeState)) return null;
  if (typeof item.subState !== "string" && item.subState !== null) return null;
  if (typeof item.unitFileState !== "string" && item.unitFileState !== null) return null;
  if (typeof item.preset !== "string") return null;
  if (typeof item.enabledHint !== "boolean") return null;
  if (item.mainPid !== null && !Number.isFinite(item.mainPid)) return null;
  if (item.execMainPid !== null && !Number.isFinite(item.execMainPid)) return null;
  if (item.execMainStatus !== null && !Number.isFinite(item.execMainStatus)) return null;
  if (item.nRestarts !== null && (!Number.isFinite(item.nRestarts) || item.nRestarts < 0))
    return null;
  if (item.activeEnterTimestamp !== null && !isValidIso(item.activeEnterTimestamp)) return null;
  if (item.activeExitTimestamp !== null && !isValidIso(item.activeExitTimestamp)) return null;
  if (item.inactiveEnterTimestamp !== null && !isValidIso(item.inactiveEnterTimestamp)) return null;
  if (item.inactiveExitTimestamp !== null && !isValidIso(item.inactiveExitTimestamp)) return null;
  if (
    item.uptimeSeconds !== null &&
    (!Number.isFinite(item.uptimeSeconds) || item.uptimeSeconds < 0)
  )
    return null;
  if (item.memoryCurrentBytes !== null && !Number.isFinite(item.memoryCurrentBytes)) return null;
  if (item.cpuUsageNsec !== null && !Number.isFinite(item.cpuUsageNsec)) return null;
  if (typeof item.fragmentPath !== "string" && item.fragmentPath !== null) return null;
  if (typeof item.sourcePath !== "string" && item.sourcePath !== null) return null;
  if (typeof item.result !== "string" && item.result !== null) return null;
  if (typeof item.type !== "string" && item.type !== null) return null;
  if (typeof item.restart !== "string" && item.restart !== null) return null;
  if (item.fieldsUnknown !== undefined && !Array.isArray(item.fieldsUnknown)) return null;
  if (item.error !== null && !isPlainObject(item.error)) return null;
  // Sem caracteres de controle no description/paths.
  const strFields = [
    item.description,
    item.loadState,
    item.subState,
    item.fragmentPath,
    item.sourcePath,
    item.result,
  ];
  for (const v of strFields) {
    if (typeof v === "string" && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) return null;
  }
  return true;
}

function validateStationServicesReport(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok !== true) return null;
  if (body.schemaVersion !== 1) return null;
  if (!isValidIso(body.generatedAt)) return null;
  if (!Number.isInteger(body.count) || body.count < 0) return null;
  if (!isPlainObject(body.summary)) return null;
  if (!Array.isArray(body.services) || body.services.length !== body.count) return null;
  if (
    !isPlainObject(body.summary.byActiveState) ||
    !isPlainObject(body.summary.byUnitFileState) ||
    !isPlainObject(body.summary.enabledDisabled)
  ) {
    return null;
  }
  if (body.summary.total !== body.count) return null;
  if (!Number.isInteger(body.summary.failed) || body.summary.failed < 0) return null;
  for (const [state, count] of Object.entries(body.summary.byActiveState)) {
    if (!ACTIVE_STATES.has(state) && state !== "unknown") return null;
    if (!Number.isInteger(count) || count < 0) return null;
  }
  for (const [state, count] of Object.entries(body.summary.byUnitFileState)) {
    if (!UNIT_FILE_STATES.has(state) && state !== "unknown") return null;
    if (!Number.isInteger(count) || count < 0) return null;
  }
  for (const [state, count] of Object.entries(body.summary.enabledDisabled)) {
    if (state !== "enabled" && state !== "disabled") return null;
    if (!Number.isInteger(count) || count < 0) return null;
  }
  const seen = new Set();
  let prevUnit = null;
  for (const item of body.services) {
    if (!validateReportService(item)) return null;
    if (seen.has(item.unit)) return null;
    seen.add(item.unit);
    if (prevUnit !== null && item.unit <= prevUnit) return null;
    prevUnit = item.unit;
  }
  return {
    ok: true,
    schemaVersion: 1,
    generatedAt: body.generatedAt,
    count: body.count,
    summary: body.summary,
    services: body.services,
  };
}

export async function fetchStationServicesReport(stationConfig, env = process.env) {
  const timeoutMs = resolveReportTimeoutMs(env);
  const result = await fetchStationResource(
    SERVICES_REPORT_PATH,
    validateStationServicesReport,
    stationConfig,
    timeoutMs,
    "GET",
    null,
    MAX_BODY_BYTES_REPORT,
  );
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, report: resource };
}

export async function fetchStationSystemStatus(stationConfig) {
  const result = await fetchStationResource(SYSTEM_PATH, validateStationSystem, stationConfig);
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, system: resource };
}

export function resolveUpdatesConsoleTimeoutMs(
  env = process.env,
  fallback = UPDATES_CONSOLE_TIMEOUT_MS,
) {
  const raw = env.HESTIA_STATION_UPDATES_TIMEOUT_MS;
  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < UPDATES_CONSOLE_MIN_TIMEOUT_MS ||
    n > UPDATES_CONSOLE_MAX_TIMEOUT_MS
  ) {
    return fallback;
  }
  return n;
}

function validateStationApps(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok === false) {
    if (
      (body.status === "unsupported" || body.status === "error") &&
      isValidIsoDate(body.checkedAt)
    ) {
      return {
        ok: false,
        status: body.status,
        reason: typeof body.reason === "string" ? body.reason : "APPS_CHECK_FAILED",
        checkedAt: body.checkedAt,
      };
    }
    return null;
  }
  if (
    body.ok !== true ||
    body.schemaVersion !== 1 ||
    body.status !== "ok" ||
    !isValidIsoDate(body.checkedAt) ||
    !Array.isArray(body.applications)
  ) {
    return null;
  }
  return {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: body.checkedAt,
    applications: body.applications,
    summary: isPlainObject(body.summary)
      ? body.summary
      : {
          totalInstalled: body.applications.length,
          upToDate: body.applications.filter((a) => a.updateStatus === "up_to_date").length,
          updateAvailable: body.applications.filter((a) => a.updateStatus === "update_available")
            .length,
          unknownVerification: body.applications.filter((a) => a.updateStatus === "unknown").length,
        },
    providers: isPlainObject(body.providers) ? body.providers : {},
  };
}

export function resolveAppsConsoleTimeoutMs(
  env = process.env,
  fallback = UPDATES_CONSOLE_TIMEOUT_MS,
) {
  const raw = env.HESTIA_STATION_APPS_TIMEOUT_MS;
  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < UPDATES_CONSOLE_MIN_TIMEOUT_MS ||
    n > UPDATES_CONSOLE_MAX_TIMEOUT_MS
  ) {
    return fallback;
  }
  return n;
}

export async function fetchStationApps(stationConfig) {
  const timeoutMs = resolveAppsConsoleTimeoutMs();
  const result = await fetchStationResource(
    APPS_PATH,
    validateStationApps,
    stationConfig,
    timeoutMs,
  );
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  if (resource?.status === "unsupported" || resource?.status === "error") {
    return { ...metadata, ok: false, apps: resource };
  }
  return { ...metadata, apps: resource };
}

export async function updateStationApp(stationConfig, appId, options = {}) {
  const timeoutMs = resolveAppsConsoleTimeoutMs();
  const path = `/api/station/apps/${encodeURIComponent(appId)}/update`;
  const secret = typeof options.secret === "string" ? options.secret : "";
  const bodyPayload = secret ? { authorization: { type: "sudo-password", secret } } : {};
  const result = await fetchStationResource(
    path,
    (body) => (body && typeof body === "object" ? body : null),
    stationConfig,
    timeoutMs * 2,
    "POST",
    bodyPayload,
  );
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, ...resource };
}

export async function fetchStationUpdates(stationConfig) {
  const timeoutMs = resolveUpdatesConsoleTimeoutMs();
  const result = await fetchStationResource(
    UPDATES_PATH,
    validateStationUpdates,
    stationConfig,
    timeoutMs,
  );
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  if (resource?.status === "unsupported" || resource?.status === "error") {
    return { ...metadata, ok: false, updates: resource };
  }
  return { ...metadata, updates: resource };
}

export async function fetchStationTunnelStatus(stationConfig) {
  const result = await fetchStationResource(TUNNEL_PATH, validateStationTunnel, stationConfig);
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, tunnelStatus: resource };
}

export async function getStationConnectionStatus(stationConfig) {
  const result = await fetchStationHealth(stationConfig);
  return {
    ok: true,
    configured: result.state !== "not_configured",
    state: result.state,
    checkedAt: result.checkedAt,
    latencyMs: result.ok ? result.latencyMs : null,
    station: result.ok
      ? {
          service: result.station.service,
          schemaVersion: result.station.schemaVersion,
          version: result.station.version,
        }
      : null,
    ...(result.code ? { code: result.code } : {}),
  };
}

export function publicStationConfig(env = process.env) {
  const desktop = resolveNamedStationConfig("desktop", env);
  const tvbox = resolveNamedStationConfig("tvbox", env);
  const pocket = resolveNamedStationConfig("pocket", env);
  const baby = resolveNamedStationConfig("baby", env);
  const mini = resolveNamedStationConfig("mini", env);
  const max = resolveNamedStationConfig("max", env);
  const note = resolveNamedStationConfig("note", env);
  const kaos = resolveNamedStationConfig("kaos", env);
  return {
    desktopConfigured: desktop.configured,
    desktopAuthConfigured: Boolean(env.HESTIA_DESKTOP_TOKEN?.trim()),
    tvboxConfigured: tvbox.configured,
    tvboxAuthConfigured: Boolean(env.HESTIA_TVBOX_TOKEN?.trim()),
    pocketConfigured: pocket.configured,
    pocketAuthConfigured: Boolean(env.HESTIA_POCKET_TOKEN?.trim()),
    babyConfigured: baby.configured,
    babyAuthConfigured: Boolean(env.HESTIA_BABY_TOKEN?.trim()),
    miniConfigured: mini.configured,
    miniAuthConfigured: Boolean(env.HESTIA_MINI_TOKEN?.trim()),
    maxConfigured: max.configured,
    maxAuthConfigured: Boolean(env.HESTIA_MAX_TOKEN?.trim()),
    noteConfigured: note.configured,
    noteAuthConfigured: Boolean(env.HESTIA_NOTE_TOKEN?.trim()),
    kaosConfigured: kaos.configured,
    kaosAuthConfigured: Boolean(env.HESTIA_KAOS_TOKEN?.trim()),
    stationTimeoutMs: desktop.timeoutMs,
    legacyStationConfigDetected: hasLegacyStationConfig(env),
  };
}

export function stationHealthHttpStatus(code) {
  if (
    code === STATION_CODES.NOT_CONFIGURED ||
    code === STATION_CODES.MISCONFIGURED ||
    code === STATION_CODES.TIMEOUT ||
    code === STATION_CODES.UNAVAILABLE
  )
    return 503;
  return 502;
}

function validateStationSuspend(body) {
  if (!isPlainObject(body)) return null;
  if (body.ok !== true) return null;
  return { ok: true, state: body.state || "suspending", message: body.message || "em suspensão" };
}

export async function fetchStationSuspend(config, options = {}) {
  const result = await fetchStationResource(
    "/api/station/suspend",
    validateStationSuspend,
    config,
    options.timeoutMs,
    "POST",
  );
  if (!result.ok) return result;
  const { resource, ...metadata } = result;
  return { ...metadata, suspend: resource };
}
