import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStationRoutes } from "./stationRoutes.js";

const checkedAt = "2026-07-16T12:00:00.000Z";
const health = {
  ok: true,
  schemaVersion: 1,
  service: "hestia-station-agent",
  version: "test",
  checkedAt,
};
const storage = {
  ok: true,
  schemaVersion: 1,
  checkedAt,
  storage: {
    id: "kaline",
    exists: true,
    status: "ok",
    totalBytes: 10,
    usedBytes: 5,
    freeBytes: 5,
    percentUsed: 50,
  },
};
const system = {
  ok: true,
  schemaVersion: 1,
  checkedAt,
  system: {
    hostname: "station-host",
    platform: "linux",
    release: "6.8",
    arch: "x64",
    uptimeSeconds: 10,
    cpu: { model: "cpu", cores: 1, threads: 1, loadAverage: [0, 0, 0], usagePercent: 0 },
    memory: { totalBytes: 100, usedBytes: 50, freeBytes: 50, usedPercent: 50 },
    swap: { totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPercent: 0 },
    rootDisk: { totalBytes: 100, usedBytes: 10, freeBytes: 90, usedPercent: 10 },
  },
};
const services = {
  ok: true,
  schemaVersion: 1,
  checkedAt,
  services: [{ id: "tailscaled", active: true, status: "active" }],
};
const servicesReport = (extraServices = []) => {
  const list = [
    {
      unit: "taildb6c11.service",
      description: "KAOS daemon",
      loadState: "loaded",
      activeState: "active",
      subState: "running",
      unitFileState: "enabled",
      enabledHint: true,
      preset: "enabled",
      mainPid: 9999,
      execMainPid: 9999,
      execMainStatus: 0,
      nRestarts: 0,
      activeEnterTimestamp: checkedAt,
      activeExitTimestamp: null,
      inactiveEnterTimestamp: null,
      inactiveExitTimestamp: null,
      uptimeSeconds: 0,
      memoryCurrentBytes: 1024,
      cpuUsageNsec: 100,
      fragmentPath: "/etc/systemd/system/taildb6c11.service",
      sourcePath: null,
      result: "success",
      type: "simple",
      restart: "no",
      fieldsUnknown: [],
      error: null,
    },
    ...extraServices,
  ];
  return {
    ok: true,
    schemaVersion: 1,
    generatedAt: checkedAt,
    count: list.length,
    summary: {
      total: list.length,
      byActiveState: {
        active: 1,
        inactive: 0,
        failed: 0,
        activating: 0,
        deactivating: 0,
        unknown: 0,
      },
      byUnitFileState: { enabled: 1, disabled: 0, static: 0, masked: 0, unknown: 0 },
      enabledDisabled: { enabled: 1, disabled: 0 },
      failed: 0,
    },
    services: list,
  };
};
const codice = {
  ok: true,
  schemaVersion: 1,
  generatedAt: checkedAt,
  libraryAvailable: true,
  formats: ["epub", "pdf"],
};
const response = (body) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

function app(env, options = {}) {
  const server = Fastify({ logger: false });
  registerStationRoutes(server, env, options);
  return server;
}

describe("endpoint /api/stations/:id/services/report", () => {
  it("devolve inventário completo retornado pela Station sem whitelist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/services/report")) return response(servicesReport());
        return response(health);
      }),
    );
    const server = app({
      NODE_ENV: "test",
      HESTIA_KAOS_BASE_URL: "http://127.0.0.1:4523",
      HESTIA_KAOS_TOKEN: "kaos-secret",
    });
    const res = await server.inject("/api/stations/kaos/services/report");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.services[0].unit).toBe("taildb6c11.service");
    expect(res.body).not.toContain("kaos-secret");
    expect(res.body).not.toContain("127.0.0.1:4523");
  });

  it("reporta indisponibilidade sem vazar token quando a Station está fora", async () => {
    const secret = "kaos-secret-isolated";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("ECONNREFUSED");
        throw err;
      }),
    );
    const server = app({
      NODE_ENV: "test",
      HESTIA_KAOS_BASE_URL: "http://127.0.0.1:1",
      HESTIA_KAOS_TOKEN: secret,
    });
    const res = await server.inject("/api/stations/kaos/services/report");
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(res.body).not.toContain(secret);
  });

  it("bloqueia caminho de serviço que não tenha uma Station configurada", async () => {
    const server = app({
      NODE_ENV: "test",
      // Apenas KAOS configurada — qualquer outra deve cair em NOT_CONFIGURED.
      HESTIA_KAOS_BASE_URL: "http://127.0.0.1:4523",
      HESTIA_KAOS_TOKEN: "kaos-secret",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/services/report")) return response(servicesReport());
        return response(health);
      }),
    );
    // Sem HESTIA_TVBOX_* configurada, /services/report deve cair em STATION_NOT_CONFIGURED.
    const res = await server.inject("/api/stations/tvbox/services/report");
    expect(res.statusCode).toBe(503);
  });
});

describe("rotas plurais da Console", () => {
  it("expõe exatamente oito leituras e Códice somente na TV Box", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path === "/api/station/codice/health") return response(codice);
        if (path.endsWith("/health")) return response(health);
        if (path.includes("/system/")) return response(system);
        if (path.includes("/storage/")) return response(storage);
        return response(services);
      }),
    );
    const server = app({
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: "http://127.0.0.1:4518",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
      HESTIA_TVBOX_BASE_URL: "http://127.0.0.1:4519",
      HESTIA_TVBOX_TOKEN: "tvbox-token",
      HESTIA_POCKET_BASE_URL: "http://127.0.0.1:4520",
      HESTIA_POCKET_TOKEN: "pocket-token",
      HESTIA_BABY_BASE_URL: "http://127.0.0.1:4521",
      HESTIA_BABY_TOKEN: "baby-token",
      HESTIA_MINI_BASE_URL: "http://127.0.0.1:4522",
      HESTIA_MINI_TOKEN: "mini-token",
      HESTIA_MAX_BASE_URL: "http://127.0.0.1:4523",
      HESTIA_MAX_TOKEN: "max-token",
    });
    for (const id of ["desktop", "tvbox", "pocket", "baby", "mini", "max"]) {
      for (const suffix of [
        "connection",
        "health",
        "system/status",
        "storage/status",
        "services/status",
      ]) {
        expect((await server.inject(`/api/stations/${id}/${suffix}`)).statusCode).toBe(200);
      }
      expect(
        (await server.inject({ method: "POST", url: `/api/stations/${id}/wake` })).statusCode,
      ).toBe(404);
    }
    expect((await server.inject("/api/stations/tvbox/codice/health")).statusCode).toBe(200);
    expect((await server.inject("/api/stations/desktop/codice/health")).statusCode).toBe(404);
    expect((await server.inject("/api/stations/pocket/codice/health")).statusCode).toBe(404);
    expect((await server.inject("/api/stations/outro/health")).statusCode).toBe(404);
    expect((await server.inject("/api/station/health")).statusCode).toBe(404);

    const wakeResNoMac = await server.inject({ method: "POST", url: "/api/actions/wake-server" });
    expect(wakeResNoMac.statusCode).toBe(400);

    const serverWithWakeFake = app(
      {
        NODE_ENV: "test",
      },
      {
        executeWakeServerAction: vi.fn(async () => ({
          ok: true,
          target: "desktop",
          executor: "inova-adb",
          state: "wake_requested",
          sentAt: checkedAt,
        })),
      },
    );
    const wakeResOk = await serverWithWakeFake.inject({
      method: "POST",
      url: "/api/actions/wake-server",
    });
    expect(wakeResOk.statusCode).toBe(200);
    expect(JSON.parse(wakeResOk.body).state).toBe("wake_requested");
  });

  it("mantém uma Station válida quando a outra está inválida e não vaza configuração", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(health)),
    );
    const secret = "tvbox-secret";
    const server = app({
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: "url-inválida",
      HESTIA_DESKTOP_TOKEN: "desktop-secret",
      HESTIA_TVBOX_BASE_URL: "http://127.0.0.1:4519",
      HESTIA_TVBOX_TOKEN: secret,
    });
    const desktop = await server.inject("/api/stations/desktop/health");
    const tvbox = await server.inject("/api/stations/tvbox/health");
    expect(desktop.statusCode).toBe(503);
    expect(tvbox.statusCode).toBe(200);
    const serialized = `${desktop.body}${tvbox.body}`;
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("127.0.0.1:4519");
  });

  it("encaminha status 'unsupported' e 'error' do /api/station/updates sem cair em unavailable", async () => {
    const unsupportedBody = {
      ok: false,
      status: "unsupported",
      reason: "APT_NOT_AVAILABLE",
      checkedAt,
    };
    const errorBody = {
      ok: false,
      status: "error",
      reason: "APT_EXEC_FAILED",
      checkedAt,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/updates")) return response(errorBody);
        return response(health);
      }),
    );
    const server = app({
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: "http://127.0.0.1:4518",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const errRes = await server.inject("/api/stations/desktop/updates");
    expect(errRes.statusCode).toBe(200);
    expect(JSON.parse(errRes.body)).toEqual(errorBody);

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/updates")) return response(unsupportedBody);
        return response(health);
      }),
    );
    const unsupRes = await server.inject("/api/stations/desktop/updates");
    expect(unsupRes.statusCode).toBe(200);
    expect(JSON.parse(unsupRes.body)).toEqual(unsupportedBody);
  });
});
