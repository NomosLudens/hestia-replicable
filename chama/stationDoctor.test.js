import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startStationAgent } from "./stationAgent.js";
import {
  mergeStationEnv,
  parseStationDoctorArgs,
  parseStationEnv,
  runStationDoctor,
} from "./stationDoctor.js";

const allowedUserId = "11111111-1111-4111-8111-111111111111";
const codiceAuthEnv = `HESTIA_CODICE_SUPABASE_URL=https://project.example
HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic_test_key
HESTIA_CODICE_ALLOWED_USER_IDS=${allowedUserId}`;
const codiceAuthConfig = {
  codiceSupabaseUrl: "https://project.example",
  codiceSupabasePublishableKey: "sb_publishable_synthetic_test_key",
  codiceAllowedUserIds: new Set([allowedUserId]),
};

const cleanup = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

describe("Station Doctor config", () => {
  it("faz parse estrito sem expansão nem execução e ignora chaves desconhecidas", () => {
    expect(
      parseStationEnv(`
# comentário
HESTIA_STATION_HOST='127.0.0.1'
HESTIA_STATION_PORT="4518"
HESTIA_STATION_TOKEN=$(id)

HESTIA_STATION_CODICE_ENABLED=1
HESTIA_CODICE_CORS_ORIGIN=https://codice.example.test
HESTIA_CODICE_SUPABASE_URL=https://project.example
HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic_test_key
HESTIA_CODICE_ALLOWED_USER_IDS=${allowedUserId}
UNKNOWN=value
`),
    ).toEqual({
      HESTIA_STATION_HOST: "127.0.0.1",
      HESTIA_STATION_PORT: "4518",
      HESTIA_STATION_TOKEN: "$(id)",

      HESTIA_STATION_CODICE_ENABLED: "1",
      HESTIA_CODICE_CORS_ORIGIN: "https://codice.example.test",
      HESTIA_CODICE_SUPABASE_URL: "https://project.example",
      HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
      HESTIA_CODICE_ALLOWED_USER_IDS: allowedUserId,
    });
    expect(() => parseStationEnv("INVALID")).toThrow(/linha 1 inválida/);
    expect(() => parseStationEnv("HESTIA_STATION_PORT=1\nHESTIA_STATION_PORT=2")).toThrow(
      /duplicada/,
    );
    expect(() => parseStationEnv('HESTIA_STATION_TOKEN="ab"cd')).toThrow(/aspas inválidas/);
  });

  it("dá precedência ao process.env e não reconhece a flag interna", () => {
    expect(
      mergeStationEnv(
        { HESTIA_STATION_PORT: "9000", HESTIA_STATION_ALLOW_HTTP_LOOPBACK: "1" },
        { HESTIA_STATION_PORT: "4518", HESTIA_STATION_TOKEN: "file" },
      ),
    ).toEqual({ HESTIA_STATION_PORT: "9000", HESTIA_STATION_TOKEN: "file" });
    expect(parseStationEnv("HESTIA_STATION_ALLOW_HTTP_LOOPBACK=1")).toEqual({});
  });

  it("rejeita argumentos desconhecidos", () => {
    expect(() => parseStationDoctorArgs(["--unknown"])).toThrow(/desconhecido/);
    const result = spawnSync(process.execPath, ["scripts/station-doctor.mjs", "--unknown"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
  });
});

describe("Station Doctor operacional", () => {
  it("preserva NODE_ENV somente do processo ao validar Supabase HTTP", async () => {
    const root = await mkdtemp(join(tmpdir(), "hestia-station-doctor-node-env-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const storagePath = join(root, "KALINE");
    const dataDir = join(root, "data");
    await mkdir(join(storagePath, "codice", "epub"), { recursive: true });
    await mkdir(join(storagePath, "codice", "pdf"), { recursive: true });
    await writeFile(join(storagePath, "codice", "epub", "fixture.epub"), "bytes");
    await writeFile(join(storagePath, "codice", "pdf", "fixture.pdf"), "bytes");
    const token = "doctor-node-env-secret";
    const origin = "https://codice.example.test";
    const app = await startStationAgent({
      host: "127.0.0.1",
      port: 0,
      token,
      allowedHosts: "",
      storagePath,
      dataDir,
      storageSources: [],
      services: [],
      codiceEnabled: true,
      codiceCorsOrigin: origin,
      ...codiceAuthConfig,
    });
    cleanup.unshift(() => app.close());
    const port = app.server.address().port;
    const envFile = join(root, "station.env");
    const writeEnv = (supabaseUrl) =>
      writeFile(
        envFile,
        `NODE_ENV=production\nHESTIA_STATION_HOST=127.0.0.1\nHESTIA_STATION_PORT=${port}\nHESTIA_STATION_TOKEN=${token}\nHESTIA_STATION_CODICE_ENABLED=1\nHESTIA_CODICE_CORS_ORIGIN=${origin}\nHESTIA_CODICE_SUPABASE_URL=${supabaseUrl}\nHESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_synthetic_test_key\nHESTIA_CODICE_ALLOWED_USER_IDS=${allowedUserId}\nHESTIA_STORAGE_PATH=${storagePath}\nHESTIA_DATA_DIR=${dataDir}\n`,
      );
    const missingSystemctl = async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    };

    await writeEnv(`http://127.0.0.1:${port}`);
    const testResult = await runStationDoctor(
      { envFile, timeoutMs: 5000 },
      { processEnv: { NODE_ENV: "test" }, execFile: missingSystemctl },
    );
    expect(testResult.exitCode).toBe(0);
    expect(testResult.lines).toContain("ok: configuração válida");

    await writeEnv("http://supabase.example.test");
    for (const nodeEnv of [undefined, "production"]) {
      const processEnv = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      const result = await runStationDoctor(
        { envFile, timeoutMs: 5000 },
        { processEnv, execFile: missingSystemctl },
      );
      expect(result.exitCode).toBe(1);
      expect(result.lines.join("\n")).toContain(
        "HESTIA_CODICE_SUPABASE_URL exige HTTPS fora de loopback em test/development",
      );
    }
  });

  it("consulta um Agent real em produção com opt-in somente interno", async () => {
    const root = await mkdtemp(join(tmpdir(), "hestia-station-doctor-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const storagePath = join(root, "KALINE");
    const dataDir = join(root, "data");
    await mkdir(storagePath, { recursive: true });
    const token = "doctor-test-secret";
    const app = await startStationAgent({
      host: "127.0.0.1",
      port: 0,
      token,
      allowedHosts: "",
      storagePath,
      dataDir,
      storageSources: [],
      services: [],
    });
    cleanup.unshift(() => app.close());
    const port = app.server.address().port;
    const envFile = join(root, "station.env");
    await writeFile(
      envFile,
      `HESTIA_STATION_HOST=127.0.0.1\nHESTIA_STATION_PORT=${port}\nHESTIA_STATION_TOKEN=${token}\nHESTIA_STORAGE_PATH=${storagePath}\nHESTIA_DATA_DIR=${dataDir}\n`,
    );
    const missingSystemctl = async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    };
    const result = await runStationDoctor(
      { envFile, timeoutMs: 5000 },
      { processEnv: {}, execFile: missingSystemctl },
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toContain("ok: health respondeu");
    expect(result.lines.at(-1)).toBe("Station Doctor: OK COM AVISOS");
    expect(result.lines.join("\n")).not.toContain(token);
  });

  it("valida health, CORS e formatos do Códice sem expor token ou livros", async () => {
    const root = await mkdtemp(join(tmpdir(), "hestia-station-doctor-codice-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const storagePath = join(root, "KALINE");
    const dataDir = join(root, "data");
    await mkdir(join(storagePath, "codice", "epub"), { recursive: true });
    await mkdir(join(storagePath, "codice", "pdf"), { recursive: true });
    await writeFile(join(storagePath, "codice", "epub", "segredo.epub"), "bytes");
    await writeFile(join(storagePath, "codice", "pdf", "segredo.pdf"), "bytes");
    const token = "doctor-codice-secret";
    const origin = "https://codice.example.test";
    const app = await startStationAgent({
      host: "127.0.0.1",
      port: 0,
      token,
      allowedHosts: "",
      storagePath,
      dataDir,
      storageSources: [],
      services: [],
      codiceEnabled: true,
      codiceCorsOrigin: origin,
      ...codiceAuthConfig,
    });
    cleanup.unshift(() => app.close());
    const port = app.server.address().port;
    const envFile = join(root, "station.env");
    await writeFile(
      envFile,
      `HESTIA_STATION_HOST=127.0.0.1\nHESTIA_STATION_PORT=${port}\nHESTIA_STATION_TOKEN=${token}\nHESTIA_STATION_CODICE_ENABLED=1\nHESTIA_CODICE_CORS_ORIGIN=${origin}\n${codiceAuthEnv}\nHESTIA_STORAGE_PATH=${storagePath}\nHESTIA_DATA_DIR=${dataDir}\n`,
    );
    const missingSystemctl = async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    };
    const result = await runStationDoctor(
      { envFile, timeoutMs: 5000 },
      { processEnv: { NODE_ENV: "production" }, execFile: missingSystemctl },
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toContain("ok: Códice read-only respondeu");
    expect(result.lines).toContain("ok: CORS do Códice válido");
    expect(result.lines).toContain("ok: formatos epub,pdf");
    expect(result.lines.join("\n")).not.toContain(token);
    expect(result.lines.join("\n")).not.toContain("segredo");
  });
});
