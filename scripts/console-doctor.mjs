import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

import { supportsHestiaNode } from "./require-node.mjs";
import {
  classifyConsoleStationState,
  hasLegacyConsoleStationConfig,
} from "../chama/consoleDoctor.js";
import { STATION_IDS } from "../chama/stationClient.js";

const run = promisify(execFile);
const envFile = process.env.HESTIA_ENV_FILE || "/etc/default/hestia-console";
const runtimeDir = process.env.HESTIA_INSTALL_ROOT || "/opt/hestia-console";
const baseUrl = process.env.HESTIA_URL || "http://127.0.0.1:4517";
const requireSystemd = process.argv.includes("--require-systemd");
const lines = [];
let failed = false;
let warned = false;
const ok = (message) => lines.push(`ok: ${message}`);
const warn = (message) => {
  warned = true;
  lines.push(`aviso: ${message}`);
};
const bad = (message) => {
  failed = true;
  lines.push(`erro: ${message}`);
};

supportsHestiaNode(process.version)
  ? ok(`Node ${process.version}`)
  : bad(`Node >=22.13.0 necessário`);
try {
  const runtime = await stat(`${runtimeDir}/hestia.js`);
  runtime.isFile() ? ok("runtime da Console instalado") : bad("runtime da Console inválido");
} catch {
  bad("runtime da Console ausente");
}

let envText = "";
try {
  envText = await readFile(envFile, "utf8");
  if (envFile === "/etc/default/hestia-console") {
    const info = await stat(envFile);
    info.uid === 0 && (info.mode & 0o777) === 0o600
      ? ok("arquivo de configuração protegido")
      : bad("arquivo de configuração deve ser root:root 0600");
  }
} catch {
  bad("arquivo de configuração ausente");
}

if (hasLegacyConsoleStationConfig(envText)) {
  bad(
    "Configuração legada detectada. Substitua HESTIA_STATION_BASE_URL/TOKEN por HESTIA_DESKTOP_BASE_URL/TOKEN e HESTIA_TVBOX_BASE_URL/TOKEN.",
  );
} else ok("configuração legada ausente");

if (requireSystemd) {
  try {
    await run("systemctl", ["is-enabled", "hestia-console.service"]);
    ok("serviço systemd habilitado");
  } catch {
    bad("serviço systemd não habilitado");
  }
  try {
    await run("systemctl", ["is-active", "hestia-console.service"]);
    ok("serviço systemd ativo");
  } catch {
    bad("serviço systemd inativo");
  }
}

try {
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
  health.ok ? ok("Console responde em 127.0.0.1:4517") : bad("Console não respondeu");
  for (const id of STATION_IDS) {
    const response = await fetch(`${baseUrl}/api/stations/${id}/connection`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) {
      bad(`${id}: contrato inválido`);
      continue;
    }
    const classification = classifyConsoleStationState(body.state);
    if (classification === "ok") ok(`${id}: ${body.state}`);
    else if (classification === "warning") warn(`${id}: ${body.state}`);
    else bad(`${id}: ${body.state || "indisponível"}`);
  }
} catch {
  bad("Console não respondeu ao Doctor");
}

console.log(
  [
    ...lines,
    failed
      ? "Console Doctor: FALHOU"
      : warned
        ? "Console Doctor: OK COM AVISOS"
        : "Console Doctor: OK",
  ].join("\n"),
);
process.exitCode = failed ? 1 : 0;
