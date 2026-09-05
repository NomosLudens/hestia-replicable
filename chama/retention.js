// Chama Local — expurgo de arquivos antigos (planos, execuções, eventos). Roda periodicamente
// (ver hestia.js). Nunca apaga nada que a lógica ativa ainda dependa: undo só precisa do
// manifesto da própria execução (operations[]), nunca do plano original, então expirar planos
// não quebra undo de execuções já aplicadas.
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const RETENTION = {
  plansMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 dias — dry-run não aplicado é considerado obsoleto
  runsMaxAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 dias — valor de auditoria, mantido mais tempo
  eventsMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 dias
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromEnv(value, fallbackMs) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * DAY_MS : fallbackMs;
}

// Permite ajustar retenção via env (nunca via ~/.chama/config.json — é infraestrutura, mesmo
// tratamento que HESTIA_DATA_DIR). Valores inválidos/ausentes caem nos defaults de RETENTION.
export function resolveRetention(env = process.env) {
  return {
    plansMaxAgeMs: daysFromEnv(env.HESTIA_RETENTION_PLANS_DAYS, RETENTION.plansMaxAgeMs),
    runsMaxAgeMs: daysFromEnv(env.HESTIA_RETENTION_RUNS_DAYS, RETENTION.runsMaxAgeMs),
    eventsMaxAgeMs: daysFromEnv(env.HESTIA_RETENTION_EVENTS_DAYS, RETENTION.eventsMaxAgeMs),
  };
}

async function sweepDir(dir, maxAgeMs, now) {
  let removed = 0;
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return removed; // diretório ainda não existe: nada a limpar
  }
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const st = await stat(filePath);
      if (now - st.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        removed += 1;
      }
    } catch {
      // arquivo sumiu entre readdir/stat/unlink (corrida com outro processo): ignora
    }
  }
  return removed;
}

export async function sweepOldData(dataDir, retention = RETENTION, now = Date.now()) {
  const plansRemoved = await sweepDir(
    join(dataDir, "organizer", "plans"),
    retention.plansMaxAgeMs,
    now,
  );
  const runsRemoved = await sweepDir(
    join(dataDir, "organizer", "runs"),
    retention.runsMaxAgeMs,
    now,
  );
  const eventsRemoved = await sweepDir(join(dataDir, "events"), retention.eventsMaxAgeMs, now);
  return { plansRemoved, runsRemoved, eventsRemoved };
}
