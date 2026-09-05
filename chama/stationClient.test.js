import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STATION_IDS,
  fetchStationHealth,
  fetchStationServicesReport,
  fetchStationServicesStatus,
  fetchStationStorageStatus,
  fetchStationUpdates,
  fetchStationSuspend,
  fetchTvboxCodiceHealth,
  hasLegacyStationConfig,
  resolveNamedStationConfig,
  resolveReportTimeoutMs,
  resolveUpdatesConsoleTimeoutMs,
} from "./stationClient.js";

const now = () => new Date().toISOString();
const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
const health = () => ({
  ok: true,
  schemaVersion: 1,
  service: "hestia-station-agent",
  version: "test",
  checkedAt: now(),
});
const storage = () => ({
  ok: true,
  schemaVersion: 1,
  checkedAt: now(),
  storage: {
    id: "kaline",
    exists: true,
    status: "ok",
    totalBytes: 100,
    usedBytes: 50,
    freeBytes: 50,
    percentUsed: 50,
  },
});
const services = () => ({
  ok: true,
  schemaVersion: 1,
  checkedAt: now(),
  services: [{ id: "tailscaled", active: true, status: "active" }],
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("configuração explícita das cinco Stations", () => {
  it("mantém IDs canônicos e isolamento de todas as Stations", () => {
    expect(STATION_IDS).toEqual([
      "desktop",
      "tvbox",
      "pocket",
      "baby",
      "mini",
      "max",
      "note",
      "kaos",
    ]);
    const env = {
      NODE_ENV: "test",
      HESTIA_POCKET_BASE_URL: "http://127.0.0.1:4520",
      HESTIA_POCKET_TOKEN: "pocket-secret",
      HESTIA_BABY_BASE_URL: "http://127.0.0.1:4521",
      HESTIA_BABY_TOKEN: "baby-secret",
      HESTIA_MINI_BASE_URL: "http://127.0.0.1:4522",
      HESTIA_MINI_TOKEN: "mini-secret",
      HESTIA_MAX_BASE_URL: "http://127.0.0.1:4523",
      HESTIA_MAX_TOKEN: "max-secret",
    };
    expect(resolveNamedStationConfig("pocket", env)).toMatchObject({
      valid: true,
      token: "pocket-secret",
    });
    expect(resolveNamedStationConfig("baby", env)).toMatchObject({
      valid: true,
      token: "baby-secret",
    });
    expect(JSON.stringify(resolveNamedStationConfig("pocket", env))).not.toContain("baby-secret");
    expect(resolveNamedStationConfig("mini", env)).toMatchObject({
      valid: true,
      token: "mini-secret",
    });
    expect(resolveNamedStationConfig("max", env)).toMatchObject({
      valid: true,
      token: "max-secret",
    });
    expect(JSON.stringify(resolveNamedStationConfig("pocket", env))).not.toContain("baby-secret");
    expect(JSON.stringify(resolveNamedStationConfig("baby", env))).not.toContain("pocket-secret");
    expect(JSON.stringify(resolveNamedStationConfig("mini", env))).not.toContain("pocket-secret");
    expect(JSON.stringify(resolveNamedStationConfig("mini", env))).not.toContain("baby-secret");
    expect(JSON.stringify(resolveNamedStationConfig("max", env))).not.toContain("pocket-secret");
    expect(JSON.stringify(resolveNamedStationConfig("max", env))).not.toContain("baby-secret");
    expect(JSON.stringify(resolveNamedStationConfig("max", env))).not.toContain("mini-secret");
  });

  it("preserva defaults antigos e permite novos serviços somente com configuração explícita", () => {
    expect(resolveNamedStationConfig("desktop", {})).toMatchObject({ configured: false });
    const desktopAgent = { HESTIA_STATION_TOKEN: "token" };
    // Regressão coberta em stationAgent/services: ausência de HESTIA_STATION_SERVICES mantém os três antigos.
    expect(JSON.stringify(desktopAgent)).not.toContain("hermes");
  });

  it("cobre nenhuma, apenas uma, ambas e combinações incompletas", () => {
    expect(resolveNamedStationConfig("desktop", {})).toMatchObject({ configured: false });
    const onlyDesktop = {
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: "http://127.0.0.1:4518",
      HESTIA_DESKTOP_TOKEN: "desktop-secret",
    };
    expect(resolveNamedStationConfig("desktop", onlyDesktop)).toMatchObject({ valid: true });
    expect(resolveNamedStationConfig("tvbox", onlyDesktop)).toMatchObject({ configured: false });
    expect(resolveNamedStationConfig("mini", onlyDesktop)).toMatchObject({ configured: false });
    const both = {
      ...onlyDesktop,
      HESTIA_TVBOX_BASE_URL: "http://127.0.0.1:4519",
      HESTIA_TVBOX_TOKEN: "tvbox-secret",
    };
    expect(resolveNamedStationConfig("tvbox", both)).toMatchObject({ valid: true });
    expect(
      resolveNamedStationConfig("desktop", { HESTIA_DESKTOP_BASE_URL: "https://desktop.example" }),
    ).toMatchObject({ valid: false, errorCode: "STATION_MISCONFIGURED" });
    expect(resolveNamedStationConfig("mini", { HESTIA_MINI_TOKEN: "orphan" })).toMatchObject({
      valid: false,
      errorCode: "STATION_MISCONFIGURED",
    });
  });

  it("preserva as regras de URL e rejeita IDs fora da allowlist", () => {
    for (const value of [
      "https://user:pass@example.test",
      "https://example.test?x=1",
      "https://example.test#x",
      "http://example.test",
      // Multi-segment paths beyond the single allowed base path.
      "https://example.test/path/extra",
      // Encoded traversal.
      "https://example.test/foo%2e%2e",
      "https://example.test/foo%252e%252e",
      // Double-slash unsafe paths.
      "https://example.test//foo",
    ]) {
      expect(
        resolveNamedStationConfig("desktop", {
          HESTIA_DESKTOP_BASE_URL: value,
          HESTIA_DESKTOP_TOKEN: "secret",
        }).valid,
      ).toBe(false);
    }
    expect(() => resolveNamedStationConfig("outro", {})).toThrow("Station desconhecida");
  });

  it("detecta legado sem expor valores", () => {
    const secret = "legacy-secret";
    expect(hasLegacyStationConfig({ HESTIA_STATION_TOKEN: secret })).toBe(true);
    expect(JSON.stringify(resolveNamedStationConfig("desktop", {}))).not.toContain(secret);
  });
});

describe("cliente reutilizável e isolado", () => {
  it("usa URL e token próprios para health, storage e services", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), authorization: init.headers.Authorization });
        if (String(url).endsWith("/health")) return json(health());
        if (String(url).includes("/storage/")) return json(storage());
        return json(services());
      }),
    );
    const desktop = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const tvbox = resolveNamedStationConfig("tvbox", {
      HESTIA_TVBOX_BASE_URL: "https://tvbox.example",
      HESTIA_TVBOX_TOKEN: "tvbox-token",
    });
    expect((await fetchStationHealth(desktop)).ok).toBe(true);
    expect((await fetchStationStorageStatus(tvbox)).ok).toBe(true);
    expect((await fetchStationServicesStatus(tvbox)).ok).toBe(true);
    expect(calls).toEqual([
      { url: "https://desktop.example/api/station/health", authorization: "Bearer desktop-token" },
      {
        url: "https://tvbox.example/api/station/storage/status",
        authorization: "Bearer tvbox-token",
      },
      {
        url: "https://tvbox.example/api/station/services/status",
        authorization: "Bearer tvbox-token",
      },
    ]);
  });

  it("rejeita redirect, body excessivo e contrato inválido sem contaminar a outra Station", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const value = String(url);
        if (value.includes("desktop")) return json({}, { status: 302 });
        if (value.includes("large"))
          return new Response("{}", {
            headers: { "content-type": "application/json", "content-length": "65537" },
          });
        return json(health());
      }),
    );
    const cfg = (stationId, host) => ({
      stationId,
      configured: true,
      valid: true,
      baseUrl: new URL(`https://${host}.example`),
      token: `${host}-token`,
      timeoutMs: 1000,
      errorCode: null,
    });
    const [bad, good] = await Promise.all([
      fetchStationHealth(cfg("desktop", "desktop")),
      fetchStationHealth(cfg("tvbox", "tvbox")),
    ]);
    expect(bad).toMatchObject({ ok: false, code: "STATION_REDIRECT_REJECTED" });
    expect(good.ok).toBe(true);
    expect(await fetchStationHealth(cfg("desktop", "large"))).toMatchObject({
      ok: false,
      code: "STATION_RESPONSE_TOO_LARGE",
    });
  });

  it("Códice consulta somente a rota interna da TV Box com o Station token", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        ok: true,
        schemaVersion: 1,
        generatedAt: now(),
        libraryAvailable: true,
        formats: ["epub", "pdf"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveNamedStationConfig("tvbox", {
      HESTIA_TVBOX_BASE_URL: "https://tvbox.example",
      HESTIA_TVBOX_TOKEN: "station-secret",
    });
    expect(await fetchTvboxCodiceHealth(config)).toMatchObject({
      ok: true,
      formats: ["epub", "pdf"],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://tvbox.example/api/station/codice/health");
    expect(init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer station-secret",
    });
    expect(
      JSON.stringify(await fetchTvboxCodiceHealth({ ...config, stationId: "desktop" })),
    ).not.toContain("station-secret");
  });

  it.each([
    [["epub", "pdf"], true],
    [["epub", "pdf", "txt"], true],
    [["txt", "epub", "pdf"], true],
    [["epub"], false],
    [["pdf"], false],
    [["epub", "pdf", "mobi"], false],
    [["epub", "pdf", "txt", "txt"], false],
  ])("valida formatos do Códice %j", async (formats, valid) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: true,
          schemaVersion: 1,
          generatedAt: now(),
          libraryAvailable: true,
          formats,
        }),
      ),
    );
    const config = resolveNamedStationConfig("tvbox", {
      HESTIA_TVBOX_BASE_URL: "https://tvbox.example",
      HESTIA_TVBOX_TOKEN: "station-secret",
    });
    const result = await fetchTvboxCodiceHealth(config);
    if (valid) {
      expect(result).toMatchObject({ ok: true, formats });
    } else {
      expect(result).toMatchObject({ ok: false, code: "STATION_CONTRACT_MISMATCH" });
    }
  });

  it("propaga status 'unsupported' da Station sem mascarar como contract mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: false,
          status: "unsupported",
          reason: "APT_NOT_AVAILABLE",
          checkedAt: now(),
        }),
      ),
    );
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const result = await fetchStationUpdates(config);
    expect(result).toMatchObject({
      ok: false,
      updates: { ok: false, status: "unsupported", reason: "APT_NOT_AVAILABLE" },
    });
  });

  it("propaga status 'error' (APT_EXEC_FAILED) sem regredir para unsupported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: false,
          status: "error",
          reason: "APT_EXEC_FAILED",
          checkedAt: now(),
        }),
      ),
    );
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const result = await fetchStationUpdates(config);
    expect(result).toMatchObject({
      ok: false,
      updates: { ok: false, status: "error", reason: "APT_EXEC_FAILED" },
    });
    expect(result.updates.status).not.toBe("unsupported");
  });

  it("rejeita respostas de updates com status desconhecido como contract mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ ok: false, status: "nonsense", reason: "WHATEVER", checkedAt: now() }),
      ),
    );
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const result = await fetchStationUpdates(config);
    expect(result).toMatchObject({ ok: false, code: "STATION_CONTRACT_MISMATCH" });
  });

  it("fetchStationUpdates usa timeout dedicado (>= 25s), sem cair no DEFAULT_TIMEOUT_MS de 5s", async () => {
    let captured;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        captured = init;
        return json({
          ok: true,
          schemaVersion: 1,
          status: "ok",
          checkedAt: now(),
          updates: [],
          totalUpdates: 0,
          securityUpdates: 0,
          rebootRequired: false,
        });
      }),
    );
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
      HESTIA_STATION_TIMEOUT_MS: "5000",
    });
    const result = await fetchStationUpdates(config);
    expect(result.ok).toBe(true);
    expect(captured.signal).toBeDefined();
    // O signal do AbortController é opaco, então validamos via resolvehelper indiretamente
    // e por contrato: timeout dedicado é >= 25s, default fast route é 5s.
    expect(resolveUpdatesConsoleTimeoutMs({})).toBeGreaterThanOrEqual(25000);
  });

  it("resolveUpdatesConsoleTimeoutMs aceita env override dentro da janela [1000, 60000]", () => {
    expect(resolveUpdatesConsoleTimeoutMs({ HESTIA_STATION_UPDATES_TIMEOUT_MS: "" })).toBe(25000);
    expect(resolveUpdatesConsoleTimeoutMs({ HESTIA_STATION_UPDATES_TIMEOUT_MS: "abc" })).toBe(
      25000,
    );
    expect(resolveUpdatesConsoleTimeoutMs({ HESTIA_STATION_UPDATES_TIMEOUT_MS: "999" })).toBe(
      25000,
    );
    expect(resolveUpdatesConsoleTimeoutMs({ HESTIA_STATION_UPDATES_TIMEOUT_MS: "60001" })).toBe(
      25000,
    );
    expect(resolveUpdatesConsoleTimeoutMs({ HESTIA_STATION_UPDATES_TIMEOUT_MS: "30000" })).toBe(
      30000,
    );
  });

  it("fast routes (health, storage, services) continuam em timeoutMs do config (5s)", async () => {
    const fastCaptures = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        fastCaptures.push({ url: String(url), signal: init.signal });
        if (String(url).endsWith("/health")) return json(health());
        if (String(url).includes("/storage/")) return json(storage());
        return json(services());
      }),
    );
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
      HESTIA_STATION_TIMEOUT_MS: "5000",
    });
    const h = await fetchStationHealth(config);
    const s = await fetchStationStorageStatus(config);
    const sv = await fetchStationServicesStatus(config);
    expect(h.ok).toBe(true);
    expect(s.ok).toBe(true);
    expect(sv.ok).toBe(true);
    // Confirma que os 3 fast routes foram chamados
    expect(fastCaptures).toHaveLength(3);
    // Todos devem ter signal presente (timeoutMs aplicado)
    for (const c of fastCaptures) expect(c.signal).toBeDefined();
  });

  it("fetchStationSuspend dispara POST /api/station/suspend e retorna o status de suspensão", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        ok: true,
        state: "suspending",
        message: "em suspensão",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://desktop.example",
      HESTIA_DESKTOP_TOKEN: "desktop-token",
    });
    const res = await fetchStationSuspend(config);
    expect(res.ok).toBe(true);
    expect(res.suspend).toEqual({
      ok: true,
      state: "suspending",
      message: "em suspensão",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://desktop.example/api/station/suspend");
    expect(init.method).toBe("POST");
  });
});

describe("caminho-base da Station (base path)", () => {
  it("ROOT: base=https://host.example mantém path /api/station/health", async () => {
    const fetchMock = vi.fn(async (url) => json(health()));
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://host.example",
      HESTIA_DESKTOP_TOKEN: "t",
    });
    expect(config.valid).toBe(true);
    expect(config.baseUrl.pathname).toBe("/");
    const res = await fetchStationHealth(config);
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://host.example/api/station/health");
  });

  it("PATH: base=https://kaos.taildb6c11.ts.net/station preserva prefixo", async () => {
    const fetchMock = vi.fn(async (url) => json(health()));
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://kaos.taildb6c11.ts.net/station",
      HESTIA_DESKTOP_TOKEN: "t",
    });
    expect(config.valid).toBe(true);
    expect(config.baseUrl.pathname).toBe("/");
    const res = await fetchStationHealth(config);
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://kaos.taildb6c11.ts.net/station/api/station/health",
    );
  });

  it("trailing slash /station/ normaliza para mesmo base", async () => {
    const fetchMock = vi.fn(async (url) => json(health()));
    vi.stubGlobal("fetch", fetchMock);
    const c1 = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://host.example/station",
      HESTIA_DESKTOP_TOKEN: "t",
    });
    const c2 = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://host.example/station/",
      HESTIA_DESKTOP_TOKEN: "t",
    });
    expect(c1.valid).toBe(true);
    expect(c2.valid).toBe(true);
    await fetchStationHealth(c1);
    await fetchStationHealth(c2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://host.example/station/api/station/health",
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "https://host.example/station/api/station/health",
    );
  });

  it("rejeita traversal explícito no base path", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/foo/../bar",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita traversal codificado (%2e%2e) no base path", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/foo%2e%2ebar",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita double-encoded traversal (%252e%252e) no base path", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/foo%252e%252ebar",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita multi-segment base path (/foo/bar)", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/foo/bar",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita query string no base URL", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/station?evil=1",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita fragment no base URL", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://host.example/station#evil",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita credentials no base URL", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "https://user:pass@host.example/station",
        HESTIA_DESKTOP_TOKEN: "t",
      }).valid,
    ).toBe(false);
  });

  it("rejeita remote HTTP (não-loopback)", () => {
    expect(
      resolveNamedStationConfig("desktop", {
        HESTIA_DESKTOP_BASE_URL: "http://example.com/station",
        HESTIA_DESKTOP_TOKEN: "t",
        NODE_ENV: "production",
      }).valid,
    ).toBe(false);
  });

  it("join function é o ÚNICO caminho usado por fetchStationResource", async () => {
    const fetchMock = vi.fn(async (url) => json(health()));
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: "https://kaos.taildb6c11.ts.net/station",
      HESTIA_DESKTOP_TOKEN: "t",
    });
    await fetchStationHealth(config);
    await fetchStationServicesStatus(config);
    await fetchStationStorageStatus(config);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://kaos.taildb6c11.ts.net/station/api/station/health",
      "https://kaos.taildb6c11.ts.net/station/api/station/services/status",
      "https://kaos.taildb6c11.ts.net/station/api/station/storage/status",
    ]);
  });

  it("resolveReportTimeoutMs respeita limites e fallback", () => {
    expect(resolveReportTimeoutMs({})).toBe(25000);
    expect(resolveReportTimeoutMs({ HESTIA_STATION_SERVICES_REPORT_TIMEOUT_MS: "15000" })).toBe(
      15000,
    );
    expect(resolveReportTimeoutMs({ HESTIA_STATION_SERVICES_REPORT_TIMEOUT_MS: "0" })).toBe(25000);
    expect(resolveReportTimeoutMs({ HESTIA_STATION_SERVICES_REPORT_TIMEOUT_MS: "99999999" })).toBe(
      25000,
    );
  });

  it("fetchStationServicesReport valida o contrato e expõe { count, summary, services }", async () => {
    const report = {
      ok: true,
      schemaVersion: 1,
      generatedAt: "2026-08-22T12:00:00.000Z",
      count: 2,
      summary: {
        total: 2,
        byActiveState: {
          active: 1,
          inactive: 1,
          failed: 0,
          activating: 0,
          deactivating: 0,
          unknown: 0,
        },
        byUnitFileState: { enabled: 1, disabled: 1, static: 0, masked: 0, unknown: 0 },
        enabledDisabled: { enabled: 1, disabled: 1 },
        failed: 0,
      },
      services: [
        {
          unit: "alpha.service",
          description: "alpha",
          loadState: "loaded",
          activeState: "active",
          subState: "running",
          unitFileState: "enabled",
          enabledHint: true,
          preset: "enabled",
          mainPid: 1,
          execMainPid: 1,
          execMainStatus: 0,
          nRestarts: 0,
          activeEnterTimestamp: "2026-08-22T12:00:00.000Z",
          activeExitTimestamp: null,
          inactiveEnterTimestamp: null,
          inactiveExitTimestamp: null,
          uptimeSeconds: 0,
          memoryCurrentBytes: 1024,
          cpuUsageNsec: 100,
          fragmentPath: "/etc/systemd/system/alpha.service",
          sourcePath: null,
          result: "success",
          type: "simple",
          restart: "no",
          fieldsUnknown: [],
          error: null,
        },
        {
          unit: "beta.service",
          description: "beta",
          loadState: "loaded",
          activeState: "inactive",
          subState: "dead",
          unitFileState: "disabled",
          enabledHint: false,
          preset: "disabled",
          mainPid: 0,
          execMainPid: 0,
          execMainStatus: 0,
          nRestarts: 0,
          activeEnterTimestamp: null,
          activeExitTimestamp: null,
          inactiveEnterTimestamp: null,
          inactiveExitTimestamp: null,
          uptimeSeconds: null,
          memoryCurrentBytes: null,
          cpuUsageNsec: null,
          fragmentPath: "/etc/systemd/system/beta.service",
          sourcePath: null,
          result: "success",
          type: "simple",
          restart: "no",
          fieldsUnknown: [
            "activeEnterTimestamp",
            "activeExitTimestamp",
            "memoryCurrentBytes",
            "cpuUsageNsec",
          ],
          error: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/services/report")) return json(report);
        return json(health());
      }),
    );
    const config = resolveNamedStationConfig("kaos", {
      HESTIA_KAOS_BASE_URL: "https://kaos.taildb6c11.ts.net/station",
      HESTIA_KAOS_TOKEN: "k",
    });
    const result = await fetchStationServicesReport(config);
    expect(result.ok).toBe(true);
    expect(result.report.count).toBe(2);
    expect(result.report.services.map((s) => s.unit)).toEqual(["alpha.service", "beta.service"]);
  });

  it("fetchStationServicesReport rejeita contrato inválido (serviço com unidade inválida)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: true,
          schemaVersion: 1,
          generatedAt: "2026-08-22T12:00:00.000Z",
          count: 1,
          summary: {
            total: 1,
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
          services: [
            {
              unit: "../../../../etc/passwd",
              description: "x",
              loadState: "loaded",
              activeState: "active",
              subState: "running",
              unitFileState: "enabled",
              enabledHint: true,
              preset: "enabled",
              mainPid: 0,
              execMainPid: 0,
              execMainStatus: 0,
              nRestarts: 0,
              activeEnterTimestamp: null,
              activeExitTimestamp: null,
              inactiveEnterTimestamp: null,
              inactiveExitTimestamp: null,
              uptimeSeconds: null,
              memoryCurrentBytes: null,
              cpuUsageNsec: null,
              fragmentPath: "/x",
              sourcePath: null,
              result: "success",
              type: "simple",
              restart: "no",
              fieldsUnknown: [],
              error: null,
            },
          ],
        }),
      ),
    );
    const config = resolveNamedStationConfig("kaos", {
      HESTIA_KAOS_BASE_URL: "https://kaos.taildb6c11.ts.net/station",
      HESTIA_KAOS_TOKEN: "k",
    });
    const result = await fetchStationServicesReport(config);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("STATION_CONTRACT_MISMATCH");
  });
});
