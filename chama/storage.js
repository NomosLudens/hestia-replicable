// Chama Local — leitura de disco via `df -kP` para paths FIXOS.
// Nunca aceita path vindo de fora. Nunca usa `exec`.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { legacyStoragePaths } from "./legacyStorageConfig.js";

const pExecFile = promisify(execFile);

async function readOne(path) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      status: "missing",
      total: null,
      used: null,
      free: null,
      percentUsed: null,
      error: `${path} ainda não encontrada`,
    };
  }
  try {
    const { stdout } = await pExecFile("df", ["-kP", path], { timeout: 3000 });
    const lines = stdout.trim().split("\n");
    const last = lines[lines.length - 1].split(/\s+/);
    // fs, 1K-blocks, used, avail, capacity, mount
    const totalK = Number(last[1]);
    const usedK = Number(last[2]);
    const freeK = Number(last[3]);
    return {
      path,
      exists: true,
      status: "ok",
      total: totalK * 1024,
      used: usedK * 1024,
      free: freeK * 1024,
      percentUsed: totalK > 0 ? Math.round((usedK / totalK) * 100) : null,
    };
  } catch {
    return {
      path,
      exists: true,
      status: "unavailable",
      total: null,
      used: null,
      free: null,
      percentUsed: null,
      error: "df indisponível",
    };
  }
}

export async function getStorageStatus(paths = legacyStoragePaths()) {
  const items = await Promise.all(paths.map(readOne));
  return { items, checkedAt: new Date().toISOString() };
}
