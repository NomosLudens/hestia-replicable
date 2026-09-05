import { describe, expect, it, vi } from "vitest";
import {
  buildMagicPacket,
  executeWakeServerAction,
  getWakeExecutorStatus,
  sendWakeOnLanPacket,
} from "./wakeServer.js";

describe("wakeServer", () => {
  const validEnv = {
    HESTIA_WAKE_INOVA_ADB_TARGET: "inova.example:5555",
    HESTIA_WAKE_INOVA_INTERFACE: "eth0",
  };

  it("observa executor configurado e alcançável sem usar ADB", async () => {
    const probeTcp = vi.fn(async () => ({ reachable: true, error: null }));
    await expect(getWakeExecutorStatus(validEnv, { probeTcp })).resolves.toMatchObject({
      configured: true,
      state: "available",
      transportState: "unknown",
      adbEndpointReachable: true,
    });
    expect(probeTcp).toHaveBeenCalledOnce();
  });

  it("distingue executor indisponível de servidor offline", async () => {
    const result = await getWakeExecutorStatus(validEnv, {
      probeTcp: async () => ({ reachable: false, error: { code: "TCP_TIMEOUT" } }),
    });
    expect(result).toMatchObject({ state: "unavailable", adbEndpointReachable: false });
    expect(result).not.toHaveProperty("serverState");
  });

  it("classifica configuração ausente como misconfigured sem probe", async () => {
    const probeTcp = vi.fn();
    await expect(getWakeExecutorStatus({}, { probeTcp })).resolves.toMatchObject({
      configured: false,
      state: "misconfigured",
      adbEndpointReachable: null,
    });
    expect(probeTcp).not.toHaveBeenCalled();
  });

  it("classifica falha inesperada do probe como unknown", async () => {
    const result = await getWakeExecutorStatus(validEnv, {
      probeTcp: async () => {
        throw new Error("probe failed");
      },
    });
    expect(result).toMatchObject({ state: "unknown", adbEndpointReachable: null });
  });
  it("constrói o Magic Packet WoL corretamente (6x 0xFF + 16x MAC)", () => {
    const macBytes = Buffer.from("001122334455", "hex");
    const packet = buildMagicPacket(macBytes);
    expect(packet.length).toBe(102);
    expect(packet.subarray(0, 6).toString("hex")).toBe("ffffffffffff");
    expect(packet.subarray(6, 12).toString("hex")).toBe("001122334455");
    expect(packet.subarray(96, 102).toString("hex")).toBe("001122334455");
  });

  it("retorna erro quando MAC de despertar não está configurado", async () => {
    const res = await executeWakeServerAction({});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("WAKE_NOT_CONFIGURED");
  });

  it("retorna erro quando o formato do MAC é inválido", async () => {
    const res = await sendWakeOnLanPacket({ macAddress: "invalid-mac" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("WAKE_MISCONFIGURED");
  });

  it("executa WAKE pela INOVA via ADB quando configurado", async () => {
    const execAdb = vi.fn(async (args) =>
      args.at(-1) === "get-state" ? { stdout: "device\n" } : { stdout: "" },
    );
    const res = await executeWakeServerAction(
      {
        HESTIA_WAKE_SERVER_MAC: "00:11:22:33:44:55",
        HESTIA_WAKE_INOVA_ADB_TARGET: "127.0.0.1:5555",
        HESTIA_WAKE_INOVA_INTERFACE: "eth0",
      },
      { execAdb },
    );
    expect(res).toMatchObject({ ok: true, executor: "inova-adb", state: "wake_requested" });
    expect(execAdb).toHaveBeenCalledTimes(3);
    expect(execAdb.mock.calls).toEqual([
      [["connect", "127.0.0.1:5555"], 5000],
      [["-s", "127.0.0.1:5555", "get-state"], 5000],
      [
        [
          "-s",
          "127.0.0.1:5555",
          "shell",
          "busybox",
          "ether-wake",
          "-i",
          "eth0",
          "00:11:22:33:44:55",
        ],
        5000,
      ],
    ]);
  });

  it("falha quando a INOVA não está em estado device", async () => {
    const execAdb = vi.fn(async () => ({ stdout: "offline\n" }));
    const res = await executeWakeServerAction(
      {
        HESTIA_WAKE_SERVER_MAC: "00:11:22:33:44:55",
        HESTIA_WAKE_INOVA_ADB_TARGET: "127.0.0.1:5555",
        HESTIA_WAKE_INOVA_INTERFACE: "eth0",
      },
      { execAdb },
    );
    expect(res).toMatchObject({ ok: false, code: "WAKE_FAILED" });
    expect(execAdb).toHaveBeenCalledTimes(2);
  });

  it("falha quando o executor ADB rejeita", async () => {
    const execAdb = vi.fn(async () => {
      throw new Error("ADB indisponível");
    });
    const res = await executeWakeServerAction(
      {
        HESTIA_WAKE_SERVER_MAC: "00:11:22:33:44:55",
        HESTIA_WAKE_INOVA_ADB_TARGET: "127.0.0.1:5555",
        HESTIA_WAKE_INOVA_INTERFACE: "eth0",
      },
      { execAdb },
    );
    expect(res).toMatchObject({ ok: false, code: "WAKE_FAILED" });
  });
});
