import * as os from "node:os";

export function getServerStatus() {
  try {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAverage: os.loadavg(),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      error: "Não foi possível ler o estado do sistema",
      checkedAt: new Date().toISOString(),
    };
  }
}
