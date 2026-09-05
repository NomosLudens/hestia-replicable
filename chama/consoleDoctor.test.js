import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { classifyConsoleStationState, hasLegacyConsoleStationConfig } from "./consoleDoctor.js";
import { STATION_IDS } from "./stationClient.js";
import { supportsHestiaNode } from "../scripts/require-node.mjs";

function runDoctor({ baseUrl, envFile, runtimeDir }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/console-doctor.mjs"], {
      cwd: join(import.meta.dirname, ".."),
      env: {
        ...process.env,
        HESTIA_URL: baseUrl,
        HESTIA_ENV_FILE: envFile,
        HESTIA_INSTALL_ROOT: runtimeDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withDoctorRuntime() {
  const root = await mkdtemp(join(tmpdir(), "hestia-console-doctor-"));
  const runtimeDir = join(root, "runtime");
  const envFile = join(root, "hestia.env");
  await mkdir(runtimeDir);
  await writeFile(envFile, "HESTIA_DESKTOP_TOKEN=token\n");
  await writeFile(join(runtimeDir, "hestia.js"), "// runtime\n");
  return { envFile, runtimeDir };
}

async function withConsole(states, fn) {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ ok: true }));
  for (const stationId of STATION_IDS) {
    app.get(`/api/stations/${stationId}/connection`, async (_request, reply) => {
      const state = states[stationId] ?? "available";
      if (state === "http_invalid") return reply.code(502).send({ ok: false, state });
      if (state === "json_invalid") return reply.type("application/json").send("{");
      if (state === "invalid_contract") return { ok: true };
      return { ok: true, state };
    });
  }
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = app.server.address();
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

const describeDoctorScript = supportsHestiaNode(process.version) ? describe : describe.skip;

describe("Console Doctor", () => {
  it("detecta as variáveis legadas sem depender de seus valores", () => {
    expect(hasLegacyConsoleStationConfig("HESTIA_STATION_BASE_URL=https://legacy.example")).toBe(
      true,
    );
    expect(hasLegacyConsoleStationConfig("HESTIA_STATION_TOKEN=super-secret")).toBe(true);
    expect(hasLegacyConsoleStationConfig("# HESTIA_STATION_TOKEN=comentada")).toBe(false);
    expect(hasLegacyConsoleStationConfig("HESTIA_DESKTOP_TOKEN=atual")).toBe(false);
  });

  it.each([
    ["available", "ok"],
    ["not_configured", "ok"],
    ["unavailable", "warning"],
    ["misconfigured", "error"],
    ["unauthorized", "error"],
    ["incompatible", "error"],
    [undefined, "error"],
    ["novo_estado", "error"],
  ])("classifica %s como %s", (state, classification) => {
    expect(classifyConsoleStationState(state)).toBe(classification);
  });

  it("usa os sete IDs canônicos das Stations", async () => {
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
    const script = await readFile(
      join(import.meta.dirname, "..", "scripts", "console-doctor.mjs"),
      "utf8",
    );
    expect(script).toContain("for (const id of STATION_IDS)");
    expect(script).not.toContain('["desktop", "tvbox"]');
  });

  it("não permite bypass de versão real do Node no script de produção", async () => {
    const script = await readFile(
      join(import.meta.dirname, "..", "scripts", "console-doctor.mjs"),
      "utf8",
    );
    expect(script).not.toContain("HESTIA_NODE_VERSION_CHECK");
  });
});

describeDoctorScript("Console Doctor script", () => {
  it("aprova com aviso quando uma Station configurada está indisponível", async () => {
    const runtime = await withDoctorRuntime();
    await withConsole(
      {
        desktop: "unavailable",
        tvbox: "available",
        pocket: "available",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      async (baseUrl) => {
        const result = await runDoctor({ baseUrl, ...runtime });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("aviso: desktop: unavailable");
        expect(result.stdout).toContain("Console Doctor: OK COM AVISOS");
      },
    );
  });

  it("aprova Stations não configuradas sem falha fatal", async () => {
    const runtime = await withDoctorRuntime();
    await withConsole(
      {
        desktop: "available",
        tvbox: "available",
        pocket: "not_configured",
        baby: "not_configured",
        mini: "not_configured",
        max: "not_configured",
        note: "not_configured",
      },
      async (baseUrl) => {
        const result = await runDoctor({ baseUrl, ...runtime });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("ok: pocket: not_configured");
        expect(result.stdout).toContain("ok: baby: not_configured");
        expect(result.stdout).toContain("ok: mini: not_configured");
        expect(result.stdout).toContain("ok: max: not_configured");
        expect(result.stdout).toContain("ok: note: not_configured");
      },
    );
  });

  it.each([
    [
      {
        desktop: "available",
        tvbox: "available",
        pocket: "unauthorized",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      "pocket: unauthorized",
    ],
    [
      {
        desktop: "available",
        tvbox: "incompatible",
        pocket: "available",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      "tvbox: incompatible",
    ],
    [
      {
        desktop: "available",
        tvbox: "available",
        pocket: "http_invalid",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      "pocket: contrato inválido",
    ],
    [
      {
        desktop: "available",
        tvbox: "available",
        pocket: "invalid_contract",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      "pocket: indisponível",
    ],
    [
      {
        desktop: "available",
        tvbox: "available",
        pocket: "json_invalid",
        baby: "available",
        mini: "available",
        max: "available",
        note: "available",
      },
      "Console não respondeu ao Doctor",
    ],
  ])("reprova estado fatal de Station", async (states, message) => {
    const runtime = await withDoctorRuntime();
    await withConsole(states, async (baseUrl) => {
      const result = await runDoctor({ baseUrl, ...runtime });
      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`erro: ${message}`);
      expect(result.stdout).toContain("Console Doctor: FALHOU");
    });
  });

  it("reprova quando a Console local não responde", async () => {
    const runtime = await withDoctorRuntime();
    const result = await runDoctor({ baseUrl: "http://127.0.0.1:9", ...runtime });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Console Doctor: FALHOU");
  });
});
