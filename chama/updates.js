import { execFile as execFileCallback } from "node:child_process";
import { existsSync as existsSyncDefault } from "node:fs";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCallback);

export const DEFAULT_STATION_UPDATES_TIMEOUT_MS = 20000;
export const MIN_STATION_UPDATES_TIMEOUT_MS = 1000;
export const MAX_STATION_UPDATES_TIMEOUT_MS = 60000;

export function resolveUpdatesTimeoutMs(
  raw = process.env.HESTIA_STATION_UPDATES_TIMEOUT_MS,
  fallback = DEFAULT_STATION_UPDATES_TIMEOUT_MS,
) {
  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < MIN_STATION_UPDATES_TIMEOUT_MS ||
    n > MAX_STATION_UPDATES_TIMEOUT_MS
  ) {
    return fallback;
  }
  return n;
}

export function parseAptUpgradeOutput(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const updates = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("Inst ")) continue;

    // Formato de linha do `apt-get -s upgrade`:
    // Inst <pacote> [<versao_instalada>] (<versao_candidata> <origem_e_release>)
    const match = /^Inst\s+([^\s]+)\s+\[([^\]]+)\]\s+\(([^\s\)]+)(?:\s+(.*?))?\)/.exec(trimmed);
    if (!match) continue;

    const [, pkg, installedVersion, candidateVersion, originInfo = ""] = match;
    const isSecurity =
      originInfo.includes("-security") ||
      originInfo.includes("security.ubuntu.com") ||
      originInfo.includes("security.debian.org");

    updates.push({
      package: pkg,
      installedVersion,
      candidateVersion,
      security: isSecurity ? true : null,
    });
  }

  return updates;
}

export async function getStationUpdates(options = {}) {
  const runExecFile = options.execFileImpl || execFileDefault;
  const checkExists = options.existsSyncImpl || existsSyncDefault;
  const execTimeoutMs = resolveUpdatesTimeoutMs(options.timeoutMs);
  const now = new Date().toISOString();

  let stdout = "";
  try {
    const result = await runExecFile("apt-get", ["-s", "upgrade"], { timeout: execTimeoutMs });
    stdout = typeof result === "string" ? result : String(result?.stdout || "");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: false,
        status: "unsupported",
        reason: "APT_NOT_AVAILABLE",
        checkedAt: now,
      };
    }

    return {
      ok: false,
      status: "error",
      reason: "APT_EXEC_FAILED",
      checkedAt: now,
    };
  }

  const updates = parseAptUpgradeOutput(stdout);
  const rebootRequired =
    checkExists("/var/run/reboot-required") || checkExists("/var/run/reboot-required.pkgs");

  return {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: now,
    updates,
    totalUpdates: updates.length,
    securityUpdates: updates.filter((item) => item.security === true).length,
    rebootRequired,
  };
}
