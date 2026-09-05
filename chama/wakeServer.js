import dgram from "node:dgram";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseAdbTarget(target) {
  const match = /^(\S+):(\d{1,5})$/.exec(target || "");
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
  return { host: match[1], port: Number(match[2]) };
}

export function probeAdbTcp({ host, port, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (reachable, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, error });
    };
    const timer = setTimeout(() => finish(false, { code: "TCP_TIMEOUT" }), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true, null);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      finish(false, { code: error.code || "TCP_UNREACHABLE" });
    });
  });
}

export async function getWakeExecutorStatus(env = process.env, options = {}) {
  const target = env.HESTIA_WAKE_INOVA_ADB_TARGET?.trim() || "";
  const networkInterface = env.HESTIA_WAKE_INOVA_INTERFACE?.trim() || "";
  const parsed = parseAdbTarget(target);
  const checkedAt = new Date().toISOString();
  const base = {
    configured: Boolean(parsed && networkInterface),
    transportState: "unknown",
    checkedAt,
  };
  if (!parsed || !/^[A-Za-z0-9_.:-]+$/.test(networkInterface)) {
    return {
      ...base,
      state: "misconfigured",
      adbEndpointReachable: null,
      error: { code: "WAKE_EXECUTOR_NOT_CONFIGURED" },
    };
  }
  try {
    const probe = await (options.probeTcp || probeAdbTcp)({
      ...parsed,
      timeoutMs: options.timeoutMs || 1500,
    });
    return {
      ...base,
      state: probe.reachable ? "available" : "unavailable",
      adbEndpointReachable: probe.reachable,
      error: probe.error,
    };
  } catch (error) {
    return {
      ...base,
      state: "unknown",
      adbEndpointReachable: null,
      error: { code: "WAKE_EXECUTOR_PROBE_FAILED" },
    };
  }
}

function parseMacAddress(macStr) {
  if (typeof macStr !== "string") return null;
  const clean = macStr.replace(/[:-]/g, "").trim();
  if (clean.length !== 12 || !/^[0-9a-fA-F]{12}$/.test(clean)) return null;
  return Buffer.from(clean, "hex");
}

export function buildMagicPacket(macBytes) {
  if (!macBytes || macBytes.length !== 6) {
    throw new TypeError("MAC address bytes inválidos (esperado Buffer de 6 bytes)");
  }
  const prefix = Buffer.alloc(6, 0xff);
  const body = Buffer.concat(Array(16).fill(macBytes));
  return Buffer.concat([prefix, body]);
}

export async function sendWakeOnLanPacket({
  macAddress,
  broadcastAddress = "255.255.255.255",
  port = 9,
  timeoutMs = 3000,
} = {}) {
  const macBytes = parseMacAddress(macAddress);
  if (!macBytes) {
    return {
      ok: false,
      code: "WAKE_MISCONFIGURED",
      error: "MAC address de despertar inválido ou não configurado",
    };
  }

  const packet = buildMagicPacket(macBytes);

  // Alvos de broadcast (endereço de sub-rede + broadcast global)
  const targets = new Set([broadcastAddress, "255.255.255.255"]);
  // Portas padrão para WoL (porta configurada + alternativa 7)
  const ports = new Set([Number(port) || 9, 7]);

  // Se o utilitário wakeonlan do sistema operacional estiver disponível, executa também
  try {
    const cleanMac = macAddress.replace(/[:-]/g, "").trim();
    const formattedMac = cleanMac.match(/.{1,2}/g)?.join(":") || macAddress;
    await execFileAsync("wakeonlan", [
      "-i",
      broadcastAddress,
      "-p",
      String(port),
      formattedMac,
    ]).catch(() => {});
    await execFileAsync("wakeonlan", [formattedMac]).catch(() => {});
  } catch {
    // Utilitário CLI opcional
  }

  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let resolved = false;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignora erro se já fechado
      }
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          ok: false,
          code: "WAKE_TIMEOUT",
          error: "Timeout ao transmitir Magic Packet WoL",
        });
      }
    }, timeoutMs);

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          ok: false,
          code: "WAKE_FAILED",
          error: `Falha no socket UDP WoL: ${err.message}`,
        });
      }
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        let sendCount = 0;
        let errors = 0;
        const totalOps = targets.size * ports.size;

        for (const targetIp of targets) {
          for (const targetPort of ports) {
            socket.send(packet, 0, packet.length, targetPort, targetIp, (err) => {
              sendCount += 1;
              if (err) errors += 1;
              if (sendCount >= totalOps && !resolved) {
                resolved = true;
                cleanup();
                if (errors >= totalOps) {
                  resolve({
                    ok: false,
                    code: "WAKE_FAILED",
                    error: "Falha ao transmitir Magic Packet WoL para todos os alvos.",
                  });
                } else {
                  resolve({
                    ok: true,
                    target: "desktop",
                    macAddressSent: true,
                    sentAt: new Date().toISOString(),
                  });
                }
              }
            });
          }
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            ok: false,
            code: "WAKE_FAILED",
            error: `Erro de configuração do socket UDP: ${err.message}`,
          });
        }
      }
    });
  });
}

export async function executeWakeServerAction(env = process.env, options = {}) {
  const mac = env.HESTIA_WAKE_SERVER_MAC?.trim();
  const adbTarget = env.HESTIA_WAKE_INOVA_ADB_TARGET?.trim();
  const networkInterface = env.HESTIA_WAKE_INOVA_INTERFACE?.trim();

  if (
    !mac ||
    !parseMacAddress(mac) ||
    !/^\S+:\d{1,5}$/.test(adbTarget || "") ||
    !/^[A-Za-z0-9_.:-]+$/.test(networkInterface || "")
  ) {
    return {
      ok: false,
      code: "WAKE_NOT_CONFIGURED",
      error: "Despertar pela INOVA não configurado",
    };
  }

  const adbEnv = { ...process.env, HOME: "/var/lib/hestia-console" };
  const execAdb =
    options.execAdb ||
    ((args, timeout) =>
      execFileAsync("/usr/bin/adb", args, {
        env: adbEnv,
        timeout,
        maxBuffer: 64 * 1024,
      }));

  try {
    await execAdb(["connect", adbTarget], 5000);
    const state = await execAdb(["-s", adbTarget, "get-state"], 5000);
    if (state.stdout.trim() !== "device") {
      return {
        ok: false,
        code: "WAKE_FAILED",
        error: `INOVA ADB em estado inválido: ${state.stdout.trim() || "vazio"}`,
      };
    }
    await execAdb(
      ["-s", adbTarget, "shell", "busybox", "ether-wake", "-i", networkInterface, mac],
      5000,
    );
    return {
      ok: true,
      target: "desktop",
      executor: "inova-adb",
      state: "wake_requested",
      sentAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      code: "WAKE_FAILED",
      error: error?.timedOut
        ? "Timeout no executor ADB da INOVA"
        : "Falha no executor ADB da INOVA",
    };
  }
}
