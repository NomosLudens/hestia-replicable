// Chama Local — configuração central, somente leitura.
// Ordem de precedência: CLI (hestia.js) > env > ~/.chama/config.json > defaults.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isLoopbackHost, resolvePresenceCorsOrigins } from "./security.js";
import { resolveDataDir } from "./dataDir.js";
import { resolveRetention } from "./retention.js";
import { validateStorageSources } from "./storageSources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

// Whitelist opcional em ~/.chama/config.json (JSON puro).
// Só campos declarados são lidos; qualquer outro é ignorado.
function loadUserConfig() {
  const path = join(homedir(), ".chama", "config.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const out = {};
    if (typeof raw.host === "string") out.host = raw.host;
    if (Number.isFinite(raw.port)) out.port = Number(raw.port);
    if (Array.isArray(raw.storagePaths))
      out.storagePaths = raw.storagePaths.filter((s) => typeof s === "string");
    out.storageSources = validateStorageSources(raw.storageSources);
    if (Array.isArray(raw.services))
      out.services = raw.services.filter((s) => ALLOWED_SERVICES.includes(s));
    return out;
  } catch {
    return {};
  }
}

export const ALLOWED_SERVICES = Object.freeze(["jellyfin", "smbd", "tailscaled", "telegram-guard"]);
export const DEFAULT_SERVICES = Object.freeze(["jellyfin", "smbd", "tailscaled"]);
const userCfg = loadUserConfig();

const host = process.env.HESTIA_HOST || userCfg.host || "127.0.0.1";
const port = Number(process.env.HESTIA_PORT) || userCfg.port || 4517;

export const config = {
  appName: "Héstia Console",
  serverName: "Héstia",
  agentName: "Chama Local",
  version: pkg.version || "0.1.0",
  host,
  port,
  mode: "Console da TV Box: leitura local para saúde, hardware, logs, configuração e serviços.",
  readonly: true,
  readonlyByDefault: true,
  controlledWrites: true,
  lanEnabled: !isLoopbackHost(host),
  // Diretório de dados persistentes (identidade, eventos, snapshots). Só
  // vem de env/systemd — nunca do whitelist de ~/.chama/config.json.
  dataDir: resolveDataDir(),
  get storageRoot() {
    return process.env.HESTIA_STORAGE_PATH || process.env.HESTIA_KALINE_ROOT || "/KALINE";
  },
  get storagePaths() {
    return userCfg.storagePaths && userCfg.storagePaths.length > 0
      ? userCfg.storagePaths
      : ["/", this.storageRoot];
  },
  storageSources: userCfg.storageSources || [],
  services: userCfg.services && userCfg.services.length > 0 ? userCfg.services : DEFAULT_SERVICES,
  // Retenção de planos/execuções/eventos — só via env (HESTIA_RETENTION_*_DAYS), nunca do
  // whitelist de ~/.chama/config.json.
  retention: resolveRetention(),
  // CORS pra /api/presence/* — opt-in explícito via HESTIA_PRESENCE_CORS_ORIGIN, nunca ligado
  // por padrão. Vazio preserva o comportamento restritivo de sempre (same-origin/local only).
  presenceCorsOrigins: resolvePresenceCorsOrigins(),
  // Origem permitida para o Códice acessar via CORS (Tailscale/Cloudflare)
  codiceCorsOrigin: process.env.HESTIA_CODICE_CORS_ORIGIN || "",
  // Hosts extras permitidos (útil para o Tailscale Serve passar o Hostname)
  allowedHosts: process.env.HESTIA_ALLOWED_HOSTS || "",
};
