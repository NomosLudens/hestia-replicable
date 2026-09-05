import os from "node:os";
import { readFile, statfs } from "node:fs/promises";

const CPU_SAMPLE_DELAY_MS = 100;

function percent(used, total) {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProcStat(text) {
  const line = String(text).split("\n")[0];
  if (!line.startsWith("cpu ")) return null;
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  if (nums.length < 4 || nums.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const idle = nums[3] + (nums[4] || 0);
  const total = nums.reduce((sum, value) => sum + value, 0);
  return total > 0 ? { idle, total } : null;
}

function cpuDeltaPercent(before, after) {
  if (!before || !after) return null;
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (totalDelta <= 0 || idleDelta < 0) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10),
  );
}

async function readCpuUsage({ readFileImpl, delayImpl, sampleDelayMs }) {
  try {
    const before = parseProcStat(await readFileImpl("/proc/stat", "utf8"));
    await delayImpl(sampleDelayMs);
    const after = parseProcStat(await readFileImpl("/proc/stat", "utf8"));
    return cpuDeltaPercent(before, after);
  } catch {
    return null;
  }
}

async function readMeminfo(readFileImpl) {
  try {
    const text = await readFileImpl("/proc/meminfo", "utf8");
    const values = Object.fromEntries(
      text
        .split("\n")
        .map((line) => {
          const match = line.match(/^(\w+):\s+(\d+)/);
          return match ? [match[1], Number(match[2]) * 1024] : [];
        })
        .filter((entry) => entry.length),
    );
    const totalBytes = values.MemTotal || os.totalmem();
    const freeBytes = values.MemAvailable || os.freemem();
    const swapTotalBytes = values.SwapTotal || 0;
    const swapFreeBytes = values.SwapFree || 0;
    return { totalBytes, freeBytes, swapTotalBytes, swapFreeBytes };
  } catch {
    return {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
      swapTotalBytes: 0,
      swapFreeBytes: 0,
    };
  }
}

async function readRootDisk(statfsImpl) {
  const stats = await statfsImpl("/");
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return { totalBytes, usedBytes, freeBytes, usedPercent: percent(usedBytes, totalBytes) };
}

export async function getStationSystemStatus(options = {}) {
  const readFileImpl = options.readFileImpl || readFile;
  const statfsImpl = options.statfsImpl || statfs;
  const delayImpl = options.delayImpl || delay;
  const sampleDelayMs = options.sampleDelayMs ?? CPU_SAMPLE_DELAY_MS;
  const cpus = os.cpus();
  const mem = await readMeminfo(readFileImpl);
  const usedBytes = Math.max(0, mem.totalBytes - mem.freeBytes);
  const swapUsedBytes = Math.max(0, mem.swapTotalBytes - mem.swapFreeBytes);
  const [usagePercent, rootDisk] = await Promise.all([
    readCpuUsage({ readFileImpl, delayImpl, sampleDelayMs }),
    readRootDisk(statfsImpl),
  ]);
  return {
    ok: true,
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.max(0, os.uptime()),
      cpu: {
        model: cpus[0]?.model || "não disponível",
        cores: Math.max(1, cpus.length),
        threads: Math.max(1, cpus.length),
        loadAverage: os.loadavg(),
        usagePercent,
      },
      memory: {
        totalBytes: mem.totalBytes,
        usedBytes,
        freeBytes: mem.freeBytes,
        usedPercent: percent(usedBytes, mem.totalBytes),
      },
      swap: {
        totalBytes: mem.swapTotalBytes,
        usedBytes: swapUsedBytes,
        freeBytes: mem.swapFreeBytes,
        usedPercent: percent(swapUsedBytes, mem.swapTotalBytes),
      },
      rootDisk,
    },
  };
}
