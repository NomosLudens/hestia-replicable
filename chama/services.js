// Chama Local — systemctl show para lista FIXA.
// Nunca aceita nome de serviço vindo de fora.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ALLOWED_SERVICES, config } from "./config.js";

const pExecFile = promisify(execFile);

async function check(name) {
  const now = new Date().toISOString();
  try {
    const result = await pExecFile(
      "systemctl",
      ["show", name, "--property=LoadState", "--property=ActiveState", "--value"],
      { timeout: 2500 },
    );
    const stdout = typeof result === "string" ? result : result.stdout;
    const status = mapSystemctlShow(stdout);
    return { name, active: status === "active", status, checkedAt: now };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { name, active: false, status: "unavailable", checkedAt: now };
    }

    const status = mapSystemctlShow(err.stdout || "");
    return { name, active: false, status, checkedAt: now };
  }
}

export function mapSystemctlShow(raw) {
  const [loadState = "", activeState = ""] = raw
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (loadState === "not-found") return "not-installed";
  if (activeState === "active") return "active";
  if (activeState === "inactive") return "inactive";
  if (activeState === "failed") return "failed";
  return "unknown";
}

export async function getServicesStatus(serviceNames = config.services) {
  const requested = new Set(Array.isArray(serviceNames) ? serviceNames : []);
  const safeNames = ALLOWED_SERVICES.filter((name) => requested.has(name));
  const items = await Promise.all(safeNames.map(check));
  return { items };
}
