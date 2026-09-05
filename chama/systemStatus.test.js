import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStationAgent } from "./stationAgent.js";
import { getStationSystemStatus } from "./systemStatus.js";
import { fetchStationSystemStatus, resolveNamedStationConfig } from "./stationClient.js";

const originalFetch = globalThis.fetch;
const cfg = resolveNamedStationConfig("pocket", {
  HESTIA_POCKET_BASE_URL: "https://pocket.example",
  HESTIA_POCKET_TOKEN: "pocket-token",
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function validSystem(overrides = {}) {
  return {
    ok: true,
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    system: {
      hostname: "station-host",
      platform: "linux",
      release: "6.8.0",
      arch: "x64",
      uptimeSeconds: 123,
      cpu: { model: "cpu", cores: 1, threads: 2, loadAverage: [0.1, 0.2, 0.3], usagePercent: 7.4 },
      memory: { totalBytes: 100, usedBytes: 40, freeBytes: 60, usedPercent: 40 },
      swap: { totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPercent: 0 },
      rootDisk: { totalBytes: 1000, usedBytes: 200, freeBytes: 800, usedPercent: 20 },
      ...overrides,
    },
  };
}

function meminfo() {
  return "MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
}

function stat(total, idle) {
  return `cpu  ${total - idle} 0 0 ${idle} 0 0 0 0 0 0\n`;
}

describe("system status", () => {
  it("gera contrato real sem path ou dados sensíveis proibidos", async () => {
    const body = await getStationSystemStatus();
    expect(body.ok).toBe(true);
    expect(body.schemaVersion).toBe(1);
    expect(body.system.hostname).toBeTruthy();
    expect(body.system.arch).toBeTruthy();
    expect(body.system.memory.totalBytes).toBeGreaterThan(0);
    expect(body.system.rootDisk.totalBytes).toBeGreaterThan(0);
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('"path"');
    expect(serialized).not.toContain('"env"');
    expect(serialized).not.toContain('"user"');
    expect(serialized).not.toContain('"ip"');
  });

  it("calcula uso de CPU por delta entre amostras", async () => {
    const reads = [stat(100, 80), stat(200, 130)];
    const body = await getStationSystemStatus({
      readFileImpl: async (path) => (path === "/proc/stat" ? reads.shift() : meminfo()),
      statfsImpl: async () => ({ blocks: 100, bavail: 60, bsize: 10 }),
      delayImpl: async () => {},
    });
    expect(body.system.cpu.usagePercent).toBe(50);
  });

  it("mantém CPU nula quando /proc/stat está indisponível", async () => {
    const body = await getStationSystemStatus({
      readFileImpl: async (path) => {
        if (path === "/proc/stat") throw new Error("proc unavailable");
        return meminfo();
      },
      statfsImpl: async () => ({ blocks: 100, bavail: 60, bsize: 10 }),
      delayImpl: async () => {},
    });
    expect(body.system.cpu.usagePercent).toBeNull();
  });

  it("usa fallback seguro quando /proc/meminfo está indisponível e preserva swap zero", async () => {
    const reads = [stat(100, 90), stat(200, 180)];
    const body = await getStationSystemStatus({
      readFileImpl: async (path) => {
        if (path === "/proc/meminfo") throw new Error("meminfo unavailable");
        return reads.shift();
      },
      statfsImpl: async () => ({ blocks: 100, bavail: 60, bsize: 10 }),
      delayImpl: async () => {},
    });
    expect(body.system.memory.totalBytes).toBeGreaterThan(0);
    expect(body.system.swap).toMatchObject({
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      usedPercent: 0,
    });
  });

  it("propaga falha de statfs para a rota responder erro honesto", async () => {
    await expect(
      getStationSystemStatus({
        readFileImpl: async (path) => (path === "/proc/stat" ? stat(100, 90) : meminfo()),
        statfsImpl: async () => {
          throw new Error("raw / failure");
        },
        delayImpl: async () => {},
      }),
    ).rejects.toThrow("raw / failure");
  });

  it("responde 503 sanitizado no handler real quando statfs falha", async () => {
    const app = createStationAgent(
      { host: "127.0.0.1", port: 0, token: "token", services: [] },
      {
        getStationSystemStatus: async () => {
          throw new Error("raw / failure");
        },
      },
    );
    const response = await app.inject({
      url: "/api/station/system/status",
      headers: { authorization: "Bearer token", host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: "system_unavailable" });
    expect(response.body).not.toContain("raw");
    expect(response.body).not.toContain("/");
    await app.close();
  });

  it("valida estritamente o contrato remoto", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(validSystem()), {
        headers: { "content-type": "application/json" },
      });
    expect((await fetchStationSystemStatus(cfg)).ok).toBe(true);

    globalThis.fetch = async () =>
      new Response(JSON.stringify(validSystem({ extra: true })), {
        headers: { "content-type": "application/json" },
      });
    expect((await fetchStationSystemStatus(cfg)).code).toBe("STATION_CONTRACT_MISMATCH");

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify(
          validSystem({
            memory: { totalBytes: 100, usedBytes: 101, freeBytes: 0, usedPercent: 101 },
          }),
        ),
        {
          headers: { "content-type": "application/json" },
        },
      );
    expect((await fetchStationSystemStatus(cfg)).code).toBe("STATION_CONTRACT_MISMATCH");

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify(validSystem({ cpu: { ...validSystem().system.cpu, usagePercent: null } })),
        {
          headers: { "content-type": "application/json" },
        },
      );
    expect((await fetchStationSystemStatus(cfg)).ok).toBe(true);
  });
});
