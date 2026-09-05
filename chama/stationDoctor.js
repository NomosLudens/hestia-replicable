import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveStationAgentConfig } from "./stationAgent.js";
import {
  fetchStationHealth,
  fetchStationSystemStatus,
  fetchStationServicesStatus,
  fetchStationStorageStatus,
} from "./stationClient.js";

export const DEFAULT_STATION_ENV_FILE = "/etc/default/hestia-station-agent";
const DEFAULT_TIMEOUT_MS = 10_000;
const RECOGNIZED_KEYS = new Set([
  "HESTIA_STATION_HOST",
  "HESTIA_STATION_PORT",
  "HESTIA_STATION_TOKEN",

  "HESTIA_STATION_CODICE_ENABLED",
  "HESTIA_CODICE_CORS_ORIGIN",
  "HESTIA_CODICE_SUPABASE_URL",
  "HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY",
  "HESTIA_CODICE_ALLOWED_USER_IDS",
  "HESTIA_STATION_ALLOWED_HOSTS",
  "HESTIA_STORAGE_PATH",
  "HESTIA_KALINE_ROOT",
  "HESTIA_STATION_SERVICES",
  "HESTIA_DATA_DIR",
]);
const execFile = promisify(execFileCallback);
const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function supportedNode(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return false;
  const [major, minor] = match.slice(1).map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

export function parseStationEnv(text) {
  const values = {};
  const seen = new Set();
  for (const [index, original] of String(text).split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`linha ${index + 1} inválida`);
    const [, key, rawValue] = match;
    if (seen.has(key)) throw new Error(`chave duplicada na linha ${index + 1}`);
    seen.add(key);
    let value = rawValue.trim();
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      if (value.length < 2 || value.at(-1) !== quote || value.slice(1, -1).includes(quote)) {
        throw new Error(`aspas inválidas na linha ${index + 1}`);
      }
      value = value.slice(1, -1);
    } else if (value.includes("'") || value.includes('"')) {
      throw new Error(`aspas inválidas na linha ${index + 1}`);
    }
    if (RECOGNIZED_KEYS.has(key)) values[key] = value;
  }
  return values;
}

export function parseStationDoctorArgs(argv) {
  const options = {
    envFile: DEFAULT_STATION_ENV_FILE,
    requireSystemd: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,

    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--require-systemd") options.requireSystemd = true;
    else if (argument === "--env-file") {
      const value = argv[++index];
      if (!value) throw new Error("--env-file exige um caminho");
      options.envFile = value;
    } else if (argument === "--timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1000 || value > 30_000) {
        throw new Error("--timeout-ms deve estar entre 1000 e 30000");
      }
      options.timeoutMs = value;
    } else {
      throw new Error(`argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

export function mergeStationEnv(processEnv, fileEnv) {
  const merged = { ...fileEnv };
  for (const key of RECOGNIZED_KEYS) {
    if (processEnv[key] !== undefined) merged[key] = processEnv[key];
  }
  return merged;
}

function localHost(host) {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  if (host === "::1") return "[::1]";
  return host;
}

async function inspectDefaultEnvFile(path) {
  try {
    const info = await stat(path);
    const mode = info.mode & 0o777;
    const issues = [];
    if (!info.isFile()) issues.push("não é arquivo regular");
    if (info.uid !== 0) issues.push("dono não é root");
    if (mode !== 0o600) issues.push(`modo ${mode.toString(8).padStart(4, "0")} em vez de 0600`);
    return issues;
  } catch (error) {
    if (error.code === "ENOENT") return ["arquivo ausente"];
    return ["não foi possível inspecionar o arquivo"];
  }
}

async function readEnvFile(path) {
  try {
    return parseStationEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function systemdStatus(runExecFile) {
  const check = async (args) => {
    try {
      const result = await runExecFile("systemctl", args, { timeout: 5000 });
      return { ok: true, output: String(result.stdout || "").trim() };
    } catch (error) {
      return { ok: false, missing: error.code === "ENOENT" };
    }
  };
  const enabled = await check(["is-enabled", "hestia-station-agent.service"]);
  if (enabled.missing) return { available: false, enabled: false, active: false };
  const active = await check(["is-active", "hestia-station-agent.service"]);
  return { available: true, enabled: enabled.ok, active: active.ok };
}

export async function runStationDoctor(options = {}, dependencies = {}) {
  const envFile = options.envFile || DEFAULT_STATION_ENV_FILE;
  const requireSystemd = options.requireSystemd === true;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const processEnv = dependencies.processEnv || process.env;
  const runExecFile = dependencies.execFile || execFile;
  const lines = [];
  let failed = false;
  let warnings = false;
  const ok = (message) => lines.push(`ok: ${message}`);
  const warn = (message) => {
    warnings = true;
    lines.push(`warn: ${message}`);
  };
  const bad = (message) => {
    failed = true;
    lines.push(`erro: ${message}`);
  };

  if (supportedNode(process.versions.node)) ok(`Node ${process.version}`);
  else bad(`Node >=22.13.0 necessário (detectado ${process.version})`);
  ok(`arquitetura ${process.arch}`);
  try {
    const runtime = await stat(resolve(RUNTIME_DIR, "station.js"));
    runtime.isFile() ? ok("runtime da Station instalado") : bad("runtime da Station inválido");
  } catch {
    bad("runtime da Station ausente");
  }

  let fileEnv;
  try {
    fileEnv = await readEnvFile(envFile);
  } catch (error) {
    bad(`arquivo de configuração inválido: ${error.message}`);
    return finish();
  }

  if (envFile === DEFAULT_STATION_ENV_FILE) {
    const issues = await inspectDefaultEnvFile(envFile);
    if (issues.length === 0) ok("arquivo de configuração protegido");
    else if (requireSystemd) bad(`arquivo de configuração inseguro: ${issues.join(", ")}`);
    else warn(`arquivo de configuração inseguro: ${issues.join(", ")}`);
  }

  const agentEnv = {
    ...mergeStationEnv(processEnv, fileEnv),
    NODE_ENV: processEnv.NODE_ENV,
  };
  let config;
  try {
    config = resolveStationAgentConfig(agentEnv);
    if (!isAbsolute(config.storagePath)) throw new Error("storage root não é absoluto");
    ok("configuração válida");
  } catch (error) {
    bad(String(error.message || "configuração inválida").replace(/^\[Station Agent\]\s*/, ""));
    return finish();
  }

  const service = await systemdStatus(runExecFile);
  if (!service.available) {
    if (requireSystemd) bad("systemctl indisponível");
    else warn("systemctl indisponível");
  } else {
    if (service.enabled) ok("serviço systemd habilitado");
    else if (requireSystemd) bad("serviço systemd não habilitado");
    else warn("serviço systemd não habilitado");
    if (service.active) ok("serviço systemd ativo");
    else if (requireSystemd) bad("serviço systemd inativo");
    else warn("serviço systemd inativo");
  }

  const clientConfig = {
    stationId: "desktop",
    configured: true,
    valid: true,
    baseUrl: new URL(`http://${localHost(config.host)}:${config.port}`),
    token: config.token,
    timeoutMs,
    errorCode: null,
  };
  const health = await fetchStationHealth(clientConfig);
  if (!health.ok) {
    bad(`health falhou (${health.code})`);
    return finish();
  }
  ok("health respondeu");

  const storage = await fetchStationStorageStatus(clientConfig);
  if (!storage.ok) bad(`storage falhou (${storage.code})`);
  else if (storage.storage.storage.status === "ok") ok("storage disponível");
  else warn(`storage ${storage.storage.storage.status}`);

  const services = await fetchStationServicesStatus(clientConfig);
  if (!services.ok) bad(`serviços falharam (${services.code})`);
  else {
    for (const item of services.services.services) {
      if (item.status === "active") ok(`${item.id} ativo`);
      else warn(`${item.id} ${item.status}`);
    }
  }

  const system = await fetchStationSystemStatus(clientConfig);
  if (!system.ok) bad(`system falhou (${system.code})`);
  else if (
    system.system.system.hostname.trim() &&
    system.system.system.arch.trim() &&
    system.system.system.memory.totalBytes > 0 &&
    system.system.system.rootDisk.totalBytes > 0
  )
    ok("system respondeu");
  else bad("system contrato inválido");

  if (config.codiceEnabled) {
    let response;
    let body;
    try {
      response = await fetch(
        `http://${localHost(config.host)}:${config.port}/api/station/codice/health`,
        {
          headers: { Accept: "application/json", Authorization: `Bearer ${config.token}` },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      body = await response.json();
    } catch {
      bad("Códice read-only falhou");
      return finish();
    }
    const validContract =
      response.status === 200 &&
      body?.ok === true &&
      body.schemaVersion === 1 &&
      body.libraryAvailable === true &&
      Array.isArray(body.formats);
    if (!validContract) {
      bad(
        response.status === 503 ? "biblioteca do Códice indisponível" : "Códice read-only falhou",
      );
      return finish();
    }
    ok("Códice read-only respondeu");
    let preflight;
    try {
      preflight = await fetch(`http://${localHost(config.host)}:${config.port}/api/codice/health`, {
        method: "OPTIONS",
        headers: {
          Origin: config.codiceCorsOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      bad("CORS do Códice inválido");
      return finish();
    }
    const allowHeaders = preflight.headers.get("access-control-allow-headers") || "";
    const corsValid =
      preflight.status === 204 &&
      preflight.headers.get("access-control-allow-origin") === config.codiceCorsOrigin &&
      allowHeaders.split(",").some((value) => value.trim().toLowerCase() === "authorization") &&
      preflight.headers.get("access-control-allow-credentials") === null &&
      preflight.headers.get("accept-ranges") === null &&
      preflight.headers.get("content-range") === null;
    if (corsValid) {
      ok("CORS do Códice válido");
    } else {
      bad("CORS do Códice inválido");
    }
    const formats = body.formats.filter((format) => ["epub", "pdf", "txt"].includes(format));
    if (!formats.includes("epub") || !formats.includes("pdf")) {
      bad("biblioteca do Códice indisponível");
    } else {
      ok(`formatos ${formats.join(",")}`);
    }
  }
  return finish();

  function finish() {
    const summary = failed
      ? "Station Doctor: FALHOU"
      : warnings
        ? "Station Doctor: OK COM AVISOS"
        : "Station Doctor: OK";
    return { exitCode: failed ? 1 : 0, lines: [...lines, summary] };
  }
}
