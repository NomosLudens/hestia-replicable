import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStationHealth } from "./stationClient.js";
import { registerStationRoutes } from "./stationRoutes.js";
import Fastify from "fastify";
import {
  createStationAgent,
  resolveStationAgentConfig,
  startStationAgent,
} from "./stationAgent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const token = "station-test-token";
const userToken = "supabase-user-token";
const allowedUserId = "11111111-1111-4111-8111-111111111111";
const codiceOrigin = "https://codice.example.test";
const codiceRuntime = {
  codiceSupabaseUrl: "https://project.example",
  codiceSupabasePublishableKey: "sb_publishable_synthetic_test_key",
  codiceAllowedUserIds: new Set([allowedUserId]),
};
const apps = [];
const tempRoots = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function start(overrides = {}, providers = {}) {
  const app = await startStationAgent(
    {
      host: "127.0.0.1",
      port: 0,
      token,
      allowedHosts: "",
      ...codiceRuntime,
      ...overrides,
    },
    {
      fetch: providers.fetch || (async () => Response.json({ id: allowedUserId }, { status: 200 })),
      ...providers,
    },
  );
  apps.push(app);
  const { port } = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function authenticated(baseUrl, path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
}

function request(baseUrl, options) {
  return fetch(`${baseUrl}/api/station/health`, options);
}

function requestWithHost(baseUrl, host) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `${baseUrl}/api/station/health`,
      { headers: { Host: host, Authorization: `Bearer ${token}` } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) });
        });
      },
    );
    request.on("error", reject);
  });
}

describe("Station Agent", () => {
  it("desativa o Códice por padrão e aceita somente 0 ou 1", () => {
    const base = { HESTIA_STATION_TOKEN: token };
    expect(resolveStationAgentConfig(base).codiceEnabled).toBe(false);
    expect(
      resolveStationAgentConfig({ ...base, HESTIA_STATION_CODICE_ENABLED: "0" }).codiceEnabled,
    ).toBe(false);
    expect(
      resolveStationAgentConfig({
        ...base,
        NODE_ENV: "production",
        HESTIA_STATION_CODICE_ENABLED: "1",
        HESTIA_CODICE_CORS_ORIGIN: "https://codice.example.test",
        HESTIA_CODICE_SUPABASE_URL: "https://project.example",
        HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        HESTIA_CODICE_ALLOWED_USER_IDS: allowedUserId,
      }),
    ).toMatchObject({
      codiceEnabled: true,
      codiceCorsOrigin: "https://codice.example.test",
    });
    for (const value of ["", "true", "false", "yes", "on", "2", " 1", "1 "]) {
      expect(() =>
        resolveStationAgentConfig({ ...base, HESTIA_STATION_CODICE_ENABLED: value }),
      ).toThrow("HESTIA_STATION_CODICE_ENABLED deve ser 0 ou 1");
    }
  });

  it("valida uma única origem exata e segura quando o Códice está habilitado", () => {
    const base = {
      HESTIA_STATION_TOKEN: token,
      HESTIA_STATION_CODICE_ENABLED: "1",
      NODE_ENV: "production",
      HESTIA_CODICE_SUPABASE_URL: "https://project.example",
      HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      HESTIA_CODICE_ALLOWED_USER_IDS: allowedUserId,
    };
    for (const origin of [
      undefined,
      "",
      "*",
      "https://example.com/path",
      "https://example.com?x=1",
      "https://example.com#x",
      "https://user:pass@example.com",
      "https://one.example,https://two.example",
      "javascript:alert(1)",
      "http://example.com",
      " https://example.com",
      "https://example.com/",
    ]) {
      expect(() =>
        resolveStationAgentConfig({ ...base, HESTIA_CODICE_CORS_ORIGIN: origin }),
      ).toThrow(/HESTIA_CODICE_CORS_ORIGIN/);
    }
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        resolveStationAgentConfig({
          ...base,
          NODE_ENV: "test",
          HESTIA_CODICE_CORS_ORIGIN: `http://${hostname}`,
        }).codiceCorsOrigin,
      ).toBe(`http://${hostname}`);
    }
    expect(
      resolveStationAgentConfig({
        ...base,
        NODE_ENV: "development",
        HESTIA_CODICE_CORS_ORIGIN: "http://localhost",
      }).codiceCorsOrigin,
    ).toBe("http://localhost");
    expect(() =>
      resolveStationAgentConfig({
        ...base,
        NODE_ENV: "test",
        HESTIA_CODICE_CORS_ORIGIN: "http://192.0.2.10",
      }),
    ).toThrow(/exige HTTPS/);
    expect(() =>
      resolveStationAgentConfig({
        ...base,
        NODE_ENV: "production",
        HESTIA_CODICE_CORS_ORIGIN: "http://127.0.0.1",
      }),
    ).toThrow(/exige HTTPS/);
    expect(() =>
      resolveStationAgentConfig({
        ...base,
        HESTIA_STATION_HOST: "0.0.0.0",
        HESTIA_STATION_ALLOWED_HOSTS: "station.example.test",
        HESTIA_CODICE_CORS_ORIGIN: "https://codice.example.test",
      }),
    ).toThrow(/exige HESTIA_STATION_HOST em loopback/);
  });

  it("exige e valida a configuração Supabase e a allowlist por inteiro", () => {
    const base = {
      HESTIA_STATION_TOKEN: token,
      HESTIA_STATION_CODICE_ENABLED: "1",
      HESTIA_CODICE_CORS_ORIGIN: codiceOrigin,
      HESTIA_CODICE_SUPABASE_URL: "https://project.example",
      HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      HESTIA_CODICE_ALLOWED_USER_IDS: `${allowedUserId}, ${allowedUserId}`,
      NODE_ENV: "production",
    };
    const resolved = resolveStationAgentConfig(base);
    expect(resolved.codiceSupabaseUrl).toBe("https://project.example");
    expect([...resolved.codiceAllowedUserIds]).toEqual([allowedUserId]);
    for (const key of [
      "HESTIA_CODICE_SUPABASE_URL",
      "HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY",
      "HESTIA_CODICE_ALLOWED_USER_IDS",
    ]) {
      expect(() => resolveStationAgentConfig({ ...base, [key]: undefined })).toThrow(key);
    }
    for (const url of [
      "https://project.example/auth/v1",
      "https://project.example?x=1",
      "https://project.example#x",
      "https://user:pass@project.example",
      "http://project.example",
    ]) {
      expect(() => resolveStationAgentConfig({ ...base, HESTIA_CODICE_SUPABASE_URL: url })).toThrow(
        /HESTIA_CODICE_SUPABASE_URL/,
      );
    }
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        resolveStationAgentConfig({
          ...base,
          NODE_ENV: "test",
          HESTIA_CODICE_SUPABASE_URL: `http://${hostname}`,
        }).codiceSupabaseUrl,
      ).toBe(`http://${hostname}`);
    }
    for (const key of ["sb_secret_test", "service_role", "legacy-jwt", "publishable"])
      expect(() =>
        resolveStationAgentConfig({ ...base, HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY: key }),
      ).toThrow(/sb_publishable_/);
    for (const ids of ["", "*", `${allowedUserId},`, `not-a-uuid,${allowedUserId}`])
      expect(() =>
        resolveStationAgentConfig({ ...base, HESTIA_CODICE_ALLOWED_USER_IDS: ids }),
      ).toThrow(/HESTIA_CODICE_ALLOWED_USER_IDS/);
    expect(resolveStationAgentConfig({ HESTIA_STATION_TOKEN: token }).codiceEnabled).toBe(false);
  });

  it("falha imediatamente sem token e protege bind não-loopback", () => {
    expect(() => resolveStationAgentConfig({})).toThrow("HESTIA_STATION_TOKEN é obrigatório");
    expect(() =>
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STATION_HOST: "0.0.0.0",
      }),
    ).toThrow("bind não-loopback exige HESTIA_STATION_ALLOWED_HOSTS");
    expect(() =>
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STATION_ALLOWED_HOSTS: "*",
      }),
    ).toThrow("não aceita wildcard");
    expect(() =>
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STATION_PORT: "0",
      }),
    ).toThrow("HESTIA_STATION_PORT deve ser uma porta válida");
  });

  it("preserva os serviços padrão antigos sem variável explícita e permite novos nomes por opt-in", () => {
    const base = { HESTIA_STATION_TOKEN: token };
    expect(resolveStationAgentConfig(base).services).toEqual(["jellyfin", "smbd", "tailscaled"]);
    expect(
      resolveStationAgentConfig({
        ...base,
        HESTIA_STATION_SERVICES: "tailscaled,telegram-guard",
      }).services,
    ).toEqual(["tailscaled", "telegram-guard"]);
    expect(
      resolveStationAgentConfig({
        ...base,
        HESTIA_STATION_SERVICES: "tailscaled,telegram-guard",
      }).services,
    ).toEqual(["tailscaled", "telegram-guard"]);
  });

  it("resolve storage e serviços internos com fallback, allowlist e ordem canônica", () => {
    expect(
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_KALINE_ROOT: "/legacy",
        HESTIA_STATION_SERVICES: " tailscaled,evil,jellyfin,tailscaled ",
      }),
    ).toMatchObject({ storagePath: "/legacy", services: ["jellyfin", "tailscaled"] });
    expect(
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STORAGE_PATH: " /current/ ",
        HESTIA_KALINE_ROOT: "/legacy",
      }),
    ).toMatchObject({
      storagePath: "/current",
      services: ["jellyfin", "smbd", "tailscaled"],
    });
    expect(
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STORAGE_PATH: "/srv/KALINE/",
      }).storagePath,
    ).toBe("/srv/KALINE");
    expect(() =>
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: token,
        HESTIA_STORAGE_PATH: "srv/KALINE",
      }),
    ).toThrow("HESTIA_STORAGE_PATH deve ser absoluto");
  });

  it("retorna o contrato exato com autenticação correta", async () => {
    const { baseUrl } = await start();
    const response = await request(baseUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["ok", "schemaVersion", "service", "version", "checkedAt"]);
    expect(body).toEqual({
      ok: true,
      schemaVersion: 1,
      service: "hestia-station-agent",
      version: pkg.version,
      checkedAt: body.checkedAt,
    });
    expect(new Date(body.checkedAt).toISOString()).toBe(body.checkedAt);
  });

  it.each([
    [undefined, 401],
    ["Basic abc", 401],
    ["Bearer", 401],
    ["Bearer wrong-token", 403],
  ])("normaliza autenticação %s como %i", async (authorization, status) => {
    const { baseUrl } = await start();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await request(baseUrl, { headers });
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain(token);
  });

  it("retorna 404 em rota desconhecida", async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/unknown`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("mantém o Códice ausente por padrão sem exigir Bearer nesse namespace", async () => {
    const { baseUrl } = await start();
    for (const [method, path] of [
      ["GET", "/api/codice/health"],
      ["GET", "/api/codice/library"],
      ["POST", "/api/codice/import"],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: "not_found" });
    }
    expect((await authenticated(baseUrl, "/api/station/health")).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/station/health`)).status).toBe(401);
  });

  it("expõe somente leitura com bytes idênticos, IDs opacos e CORS exato", async () => {
    const root = await mkdtemp(join(tmpdir(), "hestia-station-codice-"));
    tempRoots.push(root);
    const epub = Buffer.from("bytes epub de teste\n");
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x74, 0x65, 0x73, 0x74, 0x65]);
    await mkdir(join(root, "codice", "epub"), { recursive: true });
    await mkdir(join(root, "codice", "pdf"), { recursive: true });
    // Fixtures sintéticas: exercitam streaming, mas não são livros EPUB/PDF válidos para leitura.
    await writeFile(join(root, "codice", "epub", "Livro Teste.epub"), epub);
    await writeFile(join(root, "codice", "pdf", "Documento.pdf"), pdf);
    await writeFile(join(root, "codice", "pdf", "ignorado.exe"), "ignore");
    const origin = codiceOrigin;
    const { baseUrl } = await start({
      storagePath: root,
      codiceEnabled: true,
      codiceCorsOrigin: origin,
      services: [],
    });
    const health = await fetch(`${baseUrl}/api/codice/health`);
    expect(health.status).toBe(403);

    const corsHealth = await fetch(`${baseUrl}/api/codice/health`, {
      headers: { Origin: origin, Authorization: `Bearer ${userToken}` },
    });
    expect(corsHealth.status).toBe(200);
    expect(corsHealth.headers.get("access-control-allow-origin")).toBe(origin);
    expect(corsHealth.headers.get("access-control-allow-credentials")).toBeNull();

    const libraryResponse = await fetch(`${baseUrl}/api/codice/library`, {
      headers: { Origin: origin, Authorization: `Bearer ${userToken}` },
    });
    expect(libraryResponse.status).toBe(200);
    expect(libraryResponse.headers.get("access-control-allow-origin")).toBe(origin);
    expect(libraryResponse.headers.get("vary")).toContain("Origin");
    expect(libraryResponse.headers.get("access-control-allow-credentials")).toBeNull();
    const library = await libraryResponse.json();
    expect(library.books).toHaveLength(2);
    expect(library.books.map((book) => book.format).sort()).toEqual(["epub", "pdf"]);
    const serialized = JSON.stringify(library);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("_fullPath");
    expect(serialized).not.toContain("_relPath");
    expect(serialized).not.toContain(token);
    for (const book of library.books) {
      expect(book.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(book.id).not.toContain("/");
      expect(book.id).not.toContain(book.name);
    }

    for (const testCase of [
      { format: "epub", bytes: epub, contentType: "application/epub+zip" },
      { format: "pdf", bytes: pdf, contentType: "application/pdf" },
    ]) {
      const book = library.books.find((item) => item.format === testCase.format);
      expect(book).toBeDefined();
      const head = await fetch(`${baseUrl}${book.url}`, {
        method: "HEAD",
        headers: { Origin: origin, Authorization: `Bearer ${userToken}` },
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("content-type")).toBe(testCase.contentType);
      expect(head.headers.get("content-length")).toBe(String(testCase.bytes.length));
      expect(head.headers.get("access-control-allow-credentials")).toBeNull();

      const get = await fetch(`${baseUrl}${book.url}`, {
        headers: { Origin: origin, Authorization: `Bearer ${userToken}` },
      });
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer())).toEqual(testCase.bytes);
      expect(get.headers.get("cache-control")).toBe("private, no-store");
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("access-control-allow-credentials")).toBeNull();
    }

    const wrongOrigin = await fetch(`${baseUrl}/api/codice/health`, {
      headers: { Origin: "https://wrong.example" },
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toEqual({ ok: false, error: "origin_not_allowed" });
    const preflight = await fetch(`${baseUrl}/api/codice/library`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect((await fetch(`${baseUrl}/api/codice/library`, { method: "OPTIONS" })).status).toBe(403);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${baseUrl}/api/codice/import`, {
        method,
        headers: { Origin: origin, Authorization: `Bearer ${userToken}` },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: "not_found" });
    }
    expect((await fetch(`${baseUrl}/api/station/health`)).status).toBe(401);
    expect((await authenticated(baseUrl, "/api/station/health")).status).toBe(200);
  });

  it("isola Supabase Auth do token administrativo e reutiliza o health interno", async () => {
    const authFetch = vi.fn(async (_url, init) => {
      if (init.headers.Authorization === `Bearer ${userToken}`)
        return Response.json({ id: allowedUserId });
      if (init.headers.Authorization === "Bearer denied-token")
        return Response.json({ id: "22222222-2222-4222-8222-222222222222" });
      return new Response(null, { status: 401 });
    });
    const root = await mkdtemp(join(tmpdir(), "hestia-station-auth-"));
    tempRoots.push(root);
    await mkdir(join(root, "codice", "epub"), { recursive: true });
    await mkdir(join(root, "codice", "pdf"), { recursive: true });
    await writeFile(join(root, "codice", "epub", "fixture.epub"), "epub");
    await writeFile(join(root, "codice", "pdf", "fixture.pdf"), "pdf");
    const { baseUrl } = await start(
      { storagePath: root, codiceEnabled: true, codiceCorsOrigin: codiceOrigin },
      { fetch: authFetch },
    );
    const codice = (authorization) =>
      fetch(`${baseUrl}/api/codice/health`, {
        headers: {
          Origin: codiceOrigin,
          ...(authorization ? { Authorization: authorization } : {}),
        },
      });
    const preflight = await fetch(`${baseUrl}/api/codice/health`, {
      method: "OPTIONS",
      headers: { Origin: codiceOrigin },
    });
    expect(preflight.status).toBe(204);
    expect(authFetch).not.toHaveBeenCalled();
    for (const authorization of [undefined, "Basic x", "Bearer", `Bearer ${token}`]) {
      const response = await codice(authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Origin");
    }
    expect((await codice("Bearer denied-token")).status).toBe(403);
    expect((await codice(`Bearer ${userToken}`)).status).toBe(200);
    for (const path of ["/api/codice/library", "/api/codice/books/invalid-id"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Origin: codiceOrigin, Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }
    const internal = await authenticated(baseUrl, "/api/station/codice/health");
    expect(internal.status).toBe(200);
    expect(authFetch).toHaveBeenCalledTimes(5);
    expect((await fetch(`${baseUrl}/api/station/codice/health`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/station/health`, {
          headers: { Authorization: `Bearer ${userToken}` },
        })
      ).status,
    ).toBe(403);
    for (const path of ["/api/station/codice/library", "/api/station/codice/books/x"])
      expect((await authenticated(baseUrl, path)).status).toBe(404);
  });

  it("rejeita Host não permitido pelo HTTP real", async () => {
    const { baseUrl } = await start();
    const response = await requestWithHost(baseUrl, "attacker.example");
    expect(response.status).toBe(421);
    expect(response.body).toEqual({ ok: false, error: "host_not_allowed" });
  });

  it("aceita Host exato da allowlist pelo HTTP real", async () => {
    const { baseUrl } = await start({ allowedHosts: "station.example.test" });
    const response = await requestWithHost(baseUrl, "station.example.test");
    expect(response.status).toBe(200);
    const body = response.body;
    expect(Object.keys(body)).toEqual(["ok", "schemaVersion", "service", "version", "checkedAt"]);
    expect(body).toEqual({
      ok: true,
      schemaVersion: 1,
      service: "hestia-station-agent",
      version: pkg.version,
      checkedAt: body.checkedAt,
    });
    expect(new Date(body.checkedAt).toISOString()).toBe(body.checkedAt);
  });

  it("integra com fetchStationHealth real e rejeita token incorreto", async () => {
    const { baseUrl } = await start();
    const good = await fetchStationHealth({
      stationId: "desktop",
      configured: true,
      valid: true,
      baseUrl: new URL(baseUrl),
      token,
      timeoutMs: 5000,
    });
    expect(good).toMatchObject({
      ok: true,
      state: "available",
      station: { service: "hestia-station-agent", version: pkg.version },
    });
    const bad = await fetchStationHealth({
      stationId: "desktop",
      configured: true,
      valid: true,
      baseUrl: new URL(baseUrl),
      token: "wrong-token",
      timeoutMs: 5000,
    });
    expect(bad).toMatchObject({
      ok: false,
      state: "unauthorized",
      code: "STATION_AUTH_FAILED",
    });
  });

  it("encerramento libera a porta", async () => {
    const first = createStationAgent({ host: "127.0.0.1", port: 0, token, allowedHosts: "" });
    await first.listen({ host: "127.0.0.1", port: 0 });
    const { port } = first.server.address();
    await first.close();
    const second = createStationAgent({ host: "127.0.0.1", port, token, allowedHosts: "" });
    await second.listen({ host: "127.0.0.1", port });
    await second.close();
  });

  it("publica storage sanitizado com contrato exato", async () => {
    const getStorageStatus = async () => ({
      checkedAt: new Date().toISOString(),
      items: [
        {
          path: "/secret/KALINE",
          error: "raw error",
          exists: true,
          status: "ok",
          total: 1000,
          used: 500,
          free: 500,
          percentUsed: 50,
        },
      ],
    });
    const { baseUrl } = await start({}, { getStorageStatus });
    const response = await authenticated(baseUrl, "/api/station/storage/status");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["ok", "schemaVersion", "checkedAt", "storage"]);
    expect(Object.keys(body.storage)).toEqual([
      "id",
      "exists",
      "status",
      "totalBytes",
      "usedBytes",
      "freeBytes",
      "percentUsed",
    ]);
    expect(body.storage).toEqual({
      id: "kaline",
      exists: true,
      status: "ok",
      totalBytes: 1000,
      usedBytes: 500,
      freeBytes: 500,
      percentUsed: 50,
    });
    expect(JSON.stringify(body)).not.toContain("/secret");
    expect(JSON.stringify(body)).not.toContain("raw error");
  });

  it.each([
    ["missing", false],
    ["unavailable", true],
  ])("normaliza storage %s sem derrubar o Agent", async (status, exists) => {
    const { baseUrl } = await start(
      {},
      {
        getStorageStatus: async () => ({
          checkedAt: new Date().toISOString(),
          items: [{ path: "/hidden", exists, status, error: "hidden" }],
        }),
      },
    );
    const response = await authenticated(baseUrl, "/api/station/storage/status");
    expect(response.status).toBe(200);
    expect((await response.json()).storage).toMatchObject({
      exists,
      status,
      totalBytes: null,
      usedBytes: null,
      freeBytes: null,
      percentUsed: null,
    });
  });

  it("publica serviços sanitizados, determinísticos e sem consultar nome proibido", async () => {
    const calls = [];
    const { baseUrl } = await start(
      { services: ["jellyfin", "tailscaled"] },
      {
        getServicesStatus: async (names) => {
          calls.push(names);
          return {
            items: [
              { name: "jellyfin", active: false, status: "not-installed", checkedAt: "hidden" },
              { name: "tailscaled", active: false, status: "unavailable", stdout: "/hidden" },
            ],
          };
        },
      },
    );
    const response = await authenticated(baseUrl, "/api/station/services/status");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["ok", "schemaVersion", "checkedAt", "services"]);
    expect(body.services).toEqual([
      { id: "jellyfin", active: false, status: "not-installed" },
      { id: "tailscaled", active: false, status: "unavailable" },
    ]);
    expect(body.services.map(Object.keys)).toEqual([
      ["id", "active", "status"],
      ["id", "active", "status"],
    ]);
    expect(calls).toEqual([["jellyfin", "tailscaled"]]);
    expect(JSON.stringify(body)).not.toContain("hidden");
  });

  it("usa df real em diretório temporário e remove o path público", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hestia-storage-"));
    try {
      const { baseUrl } = await start({ storagePath: directory });
      const response = await authenticated(baseUrl, "/api/station/storage/status");
      const body = await response.json();
      expect(body.storage.status).toBe("ok");
      expect(body.storage.totalBytes).toBeGreaterThanOrEqual(0);
      expect(body.storage.usedBytes).toBeGreaterThanOrEqual(0);
      expect(body.storage.freeBytes).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(body)).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("faz Console → Client → Agent por HTTP real sem fallback local", async () => {
    const station = await start(
      {},
      {
        getStorageStatus: async () => ({
          checkedAt: new Date().toISOString(),
          items: [{ exists: true, status: "ok", total: 777, used: 7, free: 770, percentUsed: 1 }],
        }),
      },
    );
    const consoleApp = Fastify({ logger: false });
    registerStationRoutes(consoleApp, {
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: station.baseUrl,
      HESTIA_DESKTOP_TOKEN: token,
    });
    await consoleApp.listen({ host: "127.0.0.1", port: 0 });
    apps.push(consoleApp);
    const { port } = consoleApp.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/stations/desktop/storage/status`);
    expect(response.status).toBe(200);
    expect((await response.json()).storage.totalBytes).toBe(777);
  });

  it("Console mapeia falha da Estação sem vazar token ou URL", async () => {
    const station = await start();
    const secret = "wrong-secret-value";
    const consoleApp = Fastify({ logger: false });
    registerStationRoutes(consoleApp, {
      NODE_ENV: "test",
      HESTIA_DESKTOP_BASE_URL: station.baseUrl,
      HESTIA_DESKTOP_TOKEN: secret,
    });
    await consoleApp.listen({ host: "127.0.0.1", port: 0 });
    apps.push(consoleApp);
    const { port } = consoleApp.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/stations/desktop/storage/status`);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(Object.keys(body)).toEqual(["ok", "code", "state", "error", "checkedAt"]);
    expect(body).toMatchObject({
      ok: false,
      code: "STATION_AUTH_FAILED",
      state: "unauthorized",
      error: "desktop storage indisponível",
    });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain(station.baseUrl);
  });

  it("mantém autenticação, Host Guard, health e 404 nas novas rotas", async () => {
    const { baseUrl } = await start();
    expect((await fetch(`${baseUrl}/api/station/storage/status`)).status).toBe(401);
    expect((await requestWithHost(baseUrl, "attacker.example")).status).toBe(421);
    expect((await authenticated(baseUrl, "/api/station/health")).status).toBe(200);
    expect((await authenticated(baseUrl, "/unknown")).status).toBe(404);
  });
});

describe("Station Agent — observer / read-only mode (HESTIA_STATION_READ_ONLY=1)", () => {
  it("configuração carrega readOnly=false por padrão", () => {
    const cfg = resolveStationAgentConfig({ HESTIA_STATION_TOKEN: "x" });
    expect(cfg.readOnly).toBe(false);
  });

  it("configuração carrega readOnly=true quando HESTIA_STATION_READ_ONLY=1", () => {
    const cfg = resolveStationAgentConfig({
      HESTIA_STATION_TOKEN: "x",
      HESTIA_STATION_READ_ONLY: "1",
    });
    expect(cfg.readOnly).toBe(true);
  });

  it("rejeita valores diferentes de 0/1 para HESTIA_STATION_READ_ONLY", () => {
    expect(() =>
      resolveStationAgentConfig({
        HESTIA_STATION_TOKEN: "x",
        HESTIA_STATION_READ_ONLY: "yes",
      }),
    ).toThrow(/HESTIA_STATION_READ_ONLY/);
  });

  it("observer mantém GET /api/station/health funcional com Bearer válido", async () => {
    const { baseUrl } = await start({ readOnly: true });
    const response = await fetch(`${baseUrl}/api/station/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("hestia-station-agent");
  });

  it("observer retorna 404 em POST /api/station/apps/:appId/update (rota ausente)", async () => {
    const { baseUrl } = await start({ readOnly: true });
    const response = await fetch(`${baseUrl}/api/station/apps/someapp/update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secret: "x" }),
    });
    expect(response.status).toBe(404);
  });

  it("observer retorna 404 em POST /api/station/suspend (rota ausente)", async () => {
    const { baseUrl } = await start({ readOnly: true });
    const response = await fetch(`${baseUrl}/api/station/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
  });

  it("observer bloqueia qualquer método não-GET/HEAD com 404 (defesa em profundidade)", async () => {
    const { baseUrl } = await start({ readOnly: true });
    for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS", "POST"]) {
      const response = await fetch(`${baseUrl}/api/station/health`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
    }
  });

  it("observer aceita HEAD em /api/station/health", async () => {
    const { baseUrl } = await start({ readOnly: true });
    const response = await fetch(`${baseUrl}/api/station/health`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
  });

  it("modo normal (readOnly=false) PRESERVA POST /api/station/suspend", async () => {
    const suspendStation = vi.fn(async () => {});
    const { baseUrl } = await start({ readOnly: false }, { suspendStation });
    const response = await fetch(`${baseUrl}/api/station/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, state: "suspend_requested" });
    expect(suspendStation).toHaveBeenCalledTimes(1);
  });

  it("modo normal retorna 503 quando suspendStation falha", async () => {
    const suspendStation = vi.fn(async () => {
      throw new Error("suspend indisponível");
    });
    const { baseUrl } = await start({ readOnly: false }, { suspendStation });
    const response = await fetch(`${baseUrl}/api/station/suspend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "suspend_failed" });
    expect(suspendStation).toHaveBeenCalledTimes(1);
  });

  it("modo normal (readOnly=false) PRESERVA POST /api/station/apps/:appId/update", async () => {
    // Use a mock updateStationApplication to avoid actually invoking apt on
    // the test host (which can be ARMv7 / slow / sandboxed). The important
    // thing this test proves is that the route is REGISTERED, not that the
    // update workflow runs end-to-end.
    const fakeUpdateApp = async () => ({
      ok: false,
      code: "APP_NOT_FOUND",
      error: "fake app not found",
    });
    const { baseUrl } = await start(
      { readOnly: false },
      {
        updateStationApplication: fakeUpdateApp,
      },
    );
    const response = await fetch(`${baseUrl}/api/station/apps/nonexistent/update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secret: "x" }),
    });
    // Returns 400 because app doesn't exist, NOT 404 — proving the route exists.
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(404);
  });
});
