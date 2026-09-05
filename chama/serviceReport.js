// Chama Local — enumeração dinâmica e exaustiva de TODOS os serviços
// systemd instalados no host da KAOS. Fonte da verdade: `systemctl`.
//
// Sem whitelist, sem allowlist, sem mock, sem fixture. O Agent consulta o
// systemd real (systemctl list-unit-files + systemctl show por unidade) e
// devolve o report bruto. O Console/Héstia decide o que exibir.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

const LIST_TIMEOUT_MS = 8000;
const SHOW_TIMEOUT_MS = 4000;
const FIELDS = Object.freeze([
  "Id",
  "Description",
  "LoadState",
  "ActiveState",
  "SubState",
  "UnitFileState",
  "MainPID",
  "ExecMainPID",
  "ExecMainStatus",
  "NRestarts",
  "ActiveEnterTimestamp",
  "ActiveExitTimestamp",
  "InactiveEnterTimestamp",
  "InactiveExitTimestamp",
  "MemoryCurrent",
  "CPUUsageNSec",
  "FragmentPath",
  "Result",
  "Type",
  "Restart",
  "SourcePath",
]);

const MAX_SERVICES = 2048;

function isStr(value) {
  return typeof value === "string" && value.trim() !== "";
}

function emptyStringIsAbsent(raw) {
  return raw === undefined || raw === null || raw === "";
}

function safeNull(value) {
  if (emptyStringIsAbsent(value)) return null;
  return value;
}

function safeNumberOrNull(value) {
  if (emptyStringIsAbsent(value)) return null;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "[not set]" || trimmed === "[n/a]") return null;
  const bigInt = /^-?\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (Number.isFinite(bigInt)) return bigInt;
  // CPUUsageNSec / MemoryCurrent podem vir como "136544000" sem prefixo.
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function parseSystemctlShow(stdout) {
  const out = Object.create(null);
  if (typeof stdout !== "string" || stdout === "") return out;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!key || key in out) continue;
    out[key] = value;
  }
  return out;
}

function parseListUnitFiles(stdout) {
  // Cada linha NÃO-vazia de `list-unit-files` tem o formato:
  //   <unit> <state> <preset>
  // onde <unit> termina em ".service" quando filtramos por --type=service.
  // O cabeçalho "UNIT FILE STATE PRESET" só aparece sem --no-legend; com
  // --no-legend --plain a primeira linha já é um serviço. Detectamos e
  // pulamos o cabeçalho pelo conteúdo, não pela posição.
  const list = [];
  if (typeof stdout !== "string" || stdout === "") return list;
  const lines = stdout.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pula o cabeçalho se alguém o deixou passar.
    if (/^UNIT(\s+FILE)?\s+STATE\s+PRESET\s*$/.test(line)) continue;
    const parts = line.split(/\s+/);
    const [unit, state, preset] = parts;
    if (!unit || !unit.endsWith(".service")) continue;
    if (state && state.toUpperCase() === "STATE") continue; // redundância defensiva
    list.push({ unit, state: state || "unknown", preset: preset || "-" });
  }
  return list;
}

function timestampOrNull(value) {
  if (emptyStringIsAbsent(value)) return null;
  // systemctl imprime "Sat 2026-08-22 09:02:56 -03" ou timestamp epoch.
  const raw = String(value).trim();
  if (raw.endsWith(" UTC") || / [+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (/^\d+$/.test(raw)) {
    const epochMs = Number(raw) * (raw.length <= 10 ? 1000 : 1);
    if (Number.isFinite(epochMs)) return new Date(epochMs).toISOString();
  }
  // Sem offset/UTC — tenta parsing direto.
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function computeUptimeSeconds(activeEnterIso, nowIso) {
  if (!activeEnterIso || !nowIso) return null;
  const start = Date.parse(activeEnterIso);
  const end = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function buildServiceReport(unit, preset, props, generatedAtIso) {
  const description = isStr(props.Description) ? props.Description : unit;
  const loadState = safeNull(props.LoadState) || "unknown";
  const activeState = safeNull(props.ActiveState) || "unknown";
  const subState = safeNull(props.SubState) || "dead";
  const unitFileState = safeNull(props.UnitFileState) || "unknown";
  const activeEnterIso = timestampOrNull(props.ActiveEnterTimestamp);
  const activeExitIso = timestampOrNull(props.ActiveExitTimestamp);
  const inactiveEnterIso = timestampOrNull(props.InactiveEnterTimestamp);
  const inactiveExitIso = timestampOrNull(props.InactiveExitTimestamp);

  const runtimeFields = {
    description,
    loadState,
    activeState,
    subState,
    unitFileState,
    enabledHint: preset === "enabled" || unitFileState === "enabled",
    preset,
    mainPid: safeNumberOrNull(props.MainPID),
    execMainPid: safeNumberOrNull(props.ExecMainPID),
    execMainStatus: safeNumberOrNull(props.ExecMainStatus),
    nRestarts: safeNumberOrNull(props.NRestarts) ?? 0,
    activeEnterTimestamp: activeEnterIso,
    activeExitTimestamp: activeExitIso,
    inactiveEnterTimestamp: inactiveEnterIso,
    inactiveExitTimestamp: inactiveExitIso,
    uptimeSeconds: computeUptimeSeconds(activeEnterIso, generatedAtIso),
    memoryCurrentBytes: safeNumberOrNull(props.MemoryCurrent),
    cpuUsageNsec: safeNumberOrNull(props.CPUUsageNSec),
    fragmentPath: safeNull(props.FragmentPath),
    sourcePath: safeNull(props.SourcePath),
    result: safeNull(props.Result),
    type: safeNull(props.Type),
    restart: safeNull(props.Restart),
    fieldsUnknown: [
      "description",
      "loadState",
      "activeState",
      "subState",
      "unitFileState",
      "mainPid",
      "execMainPid",
      "execMainStatus",
      "nRestarts",
      "activeEnterTimestamp",
      "activeExitTimestamp",
      "memoryCurrentBytes",
      "cpuUsageNsec",
      "fragmentPath",
      "result",
    ].filter((field) => {
      if (field === "description") return !isStr(props.Description);
      if (field === "loadState") return emptyStringIsAbsent(props.LoadState);
      if (field === "activeState") return emptyStringIsAbsent(props.ActiveState);
      if (field === "subState") return emptyStringIsAbsent(props.SubState);
      if (field === "unitFileState") return emptyStringIsAbsent(props.UnitFileState);
      if (field === "mainPid") return emptyStringIsAbsent(props.MainPID);
      if (field === "execMainPid") return emptyStringIsAbsent(props.ExecMainPID);
      if (field === "execMainStatus") return emptyStringIsAbsent(props.ExecMainStatus);
      if (field === "nRestarts") return emptyStringIsAbsent(props.NRestarts);
      if (field === "activeEnterTimestamp") return activeEnterIso === null;
      if (field === "activeExitTimestamp") return activeExitIso === null;
      if (field === "memoryCurrentBytes") return safeNumberOrNull(props.MemoryCurrent) === null;
      if (field === "cpuUsageNsec") return safeNumberOrNull(props.CPUUsageNSec) === null;
      if (field === "fragmentPath") return emptyStringIsAbsent(props.FragmentPath);
      if (field === "result") return emptyStringIsAbsent(props.Result);
      return true;
    }),
    error: null,
  };

  return { unit, ...runtimeFields };
}

async function readServiceProps(unit) {
  const args = ["show", unit, "--no-pager", "--property=" + FIELDS.join(",")];
  const result = await pExecFile("systemctl", args, { timeout: SHOW_TIMEOUT_MS });
  const stdout = typeof result === "string" ? result : result.stdout;
  return parseSystemctlShow(stdout);
}

async function safeReadServiceProps(unit) {
  try {
    const props = await readServiceProps(unit);
    return { ok: true, props };
  } catch (err) {
    const stdout = typeof err?.stdout === "string" ? err.stdout : "";
    const stderr = typeof err?.stderr === "string" ? err.stderr : "";
    const message = err?.message || "systemctl show falhou";
    return {
      ok: false,
      props: parseSystemctlShow(stdout),
      error: {
        code: err?.code || "EXEC_FAILED",
        signal: err?.signal || null,
        message,
        stderr: stderr.trim() || null,
      },
    };
  }
}

function summarize(services) {
  const counts = {
    total: services.length,
    byActiveState: {
      active: 0,
      inactive: 0,
      failed: 0,
      activating: 0,
      deactivating: 0,
      unknown: 0,
    },
    byUnitFileState: { enabled: 0, disabled: 0, static: 0, masked: 0, unknown: 0 },
    enabledDisabled: { enabled: 0, disabled: 0 },
    failed: 0,
  };
  for (const svc of services) {
    const active = svc.activeState || "unknown";
    if (active in counts.byActiveState) counts.byActiveState[active] += 1;
    else counts.byActiveState.unknown += 1;
    if (active === "failed") counts.failed += 1;
    const fileState = svc.unitFileState || "unknown";
    if (fileState in counts.byUnitFileState) counts.byUnitFileState[fileState] += 1;
    else counts.byUnitFileState.unknown += 1;
    if (fileState === "enabled") counts.enabledDisabled.enabled += 1;
    if (fileState === "disabled") counts.enabledDisabled.disabled += 1;
  }
  return counts;
}

export async function getStationServicesReport(options = {}) {
  const includeTransient = options.includeTransient === true;
  const nowIso = new Date().toISOString();
  const listResult = await pExecFile(
    "systemctl",
    [
      "list-unit-files",
      "--type=service",
      "--no-pager",
      "--no-legend",
      "--plain",
      ...(includeTransient ? ["--all"] : []),
    ],
    { timeout: LIST_TIMEOUT_MS },
  );
  const stdout = typeof listResult === "string" ? listResult : listResult.stdout;
  const entries = parseListUnitFiles(stdout).slice(0, MAX_SERVICES);

  const generated = await Promise.all(
    entries.map(async ({ unit, state, preset }) => {
      const read = await safeReadServiceProps(unit);
      const props = read.props || {};
      const report = buildServiceReport(unit, preset, props, nowIso);
      // unitFileState do list-unit-files é melhor quando show falha.
      if (report.unitFileState === "unknown" && state && state !== "unknown") {
        report.unitFileState = state;
      }
      if (!read.ok) report.error = read.error;
      return report;
    }),
  );

  generated.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));

  return {
    generatedAt: nowIso,
    count: generated.length,
    summary: summarize(generated),
    services: generated,
  };
}

// Exposto para testes — a função de parsing é o coração do report.
export const __internals = Object.freeze({
  parseListUnitFiles,
  parseSystemctlShow,
  buildServiceReport,
  summarize,
  FIELDS,
  LIST_TIMEOUT_MS,
  SHOW_TIMEOUT_MS,
});
