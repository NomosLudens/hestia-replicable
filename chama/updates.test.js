import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATION_UPDATES_TIMEOUT_MS,
  getStationUpdates,
  parseAptUpgradeOutput,
  resolveUpdatesTimeoutMs,
} from "./updates.js";

const APT_FIXTURE = `
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
Calculating upgrade... Done
The following packages will be upgraded:
  bind9-host bind9-libs openssl
Inst openssl [3.0.13-0ubuntu3] (3.0.13-0ubuntu3.4 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Inst bind9-host [1:9.18.28-0ubuntu0.24.04.1] (1:9.18.28-0ubuntu0.24.04.2 Ubuntu:24.04/noble-updates [amd64])
Conf openssl (3.0.13-0ubuntu3.4 Ubuntu:24.04/noble-updates [amd64])
`;

describe("parseAptUpgradeOutput", () => {
  it("extrai pacotes, versões e classifica segurança determinística", () => {
    const updates = parseAptUpgradeOutput(APT_FIXTURE);
    expect(updates).toEqual([
      {
        package: "openssl",
        installedVersion: "3.0.13-0ubuntu3",
        candidateVersion: "3.0.13-0ubuntu3.4",
        security: true,
      },
      {
        package: "bind9-host",
        installedVersion: "1:9.18.28-0ubuntu0.24.04.1",
        candidateVersion: "1:9.18.28-0ubuntu0.24.04.2",
        security: null,
      },
    ]);
  });

  it("retorna array vazio para saída sem instalações ou texto inválido", () => {
    expect(parseAptUpgradeOutput("")).toEqual([]);
    expect(
      parseAptUpgradeOutput("Reading package lists... Done\n0 upgraded, 0 newly installed."),
    ).toEqual([]);
  });
});

describe("getStationUpdates", () => {
  it("retorna status unsupported se apt-get não estiver instalado (ENOENT)", async () => {
    const fakeExec = async () => {
      const err = new Error("spawn apt-get ENOENT");
      err.code = "ENOENT";
      throw err;
    };
    const result = await getStationUpdates({ execFileImpl: fakeExec });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(result.reason).toBe("APT_NOT_AVAILABLE");
  });

  it("retorna status ok com contadores e flag de reboot quando apt-get é executado", async () => {
    const fakeExec = async () => ({ stdout: APT_FIXTURE });
    const fakeExists = (path) => path === "/var/run/reboot-required";
    const result = await getStationUpdates({
      execFileImpl: fakeExec,
      existsSyncImpl: fakeExists,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.totalUpdates).toBe(2);
    expect(result.securityUpdates).toBe(1);
    expect(result.rebootRequired).toBe(true);
    expect(result.updates).toHaveLength(2);
  });

  it("retorna rebootRequired: false quando os arquivos de reboot não existem", async () => {
    const fakeExec = async () => ({ stdout: APT_FIXTURE });
    const fakeExists = () => false;
    const result = await getStationUpdates({
      execFileImpl: fakeExec,
      existsSyncImpl: fakeExists,
    });
    expect(result.ok).toBe(true);
    expect(result.rebootRequired).toBe(false);
  });

  it("retorna status error com razão APT_EXEC_FAILED em falhas genéricas de execução", async () => {
    const fakeExec = async () => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    };
    const result = await getStationUpdates({ execFileImpl: fakeExec });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.status).not.toBe("unsupported");
    expect(result.reason).toBe("APT_EXEC_FAILED");
  });

  it("usa o timeout dedicado para apt-get (>= 14s reais) em vez do antigo 10s hardcoded", async () => {
    let captured;
    const fakeExec = async (_cmd, _args, opts) => {
      captured = opts;
      return { stdout: APT_FIXTURE };
    };
    const result = await getStationUpdates({ execFileImpl: fakeExec, existsSyncImpl: () => false });
    expect(result.ok).toBe(true);
    expect(captured.timeout).toBeGreaterThanOrEqual(14000);
    expect(captured.timeout).toBeGreaterThan(10000);
    expect(captured.timeout).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
  });

  it("respeita timeoutMs injetado por opção e ignora env quando o option é fornecido", async () => {
    let captured;
    const fakeExec = async (_cmd, _args, opts) => {
      captured = opts;
      return { stdout: APT_FIXTURE };
    };
    const previous = process.env.HESTIA_STATION_UPDATES_TIMEOUT_MS;
    process.env.HESTIA_STATION_UPDATES_TIMEOUT_MS = "15000";
    try {
      const result = await getStationUpdates({
        execFileImpl: fakeExec,
        existsSyncImpl: () => false,
        timeoutMs: 30000,
      });
      expect(result.ok).toBe(true);
      expect(captured.timeout).toBe(30000);
    } finally {
      if (previous === undefined) delete process.env.HESTIA_STATION_UPDATES_TIMEOUT_MS;
      else process.env.HESTIA_STATION_UPDATES_TIMEOUT_MS = previous;
    }
  });
});

describe("resolveUpdatesTimeoutMs", () => {
  it("usa o default de 20s quando env é vazio ou inválido", () => {
    expect(resolveUpdatesTimeoutMs("")).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
    expect(resolveUpdatesTimeoutMs(undefined)).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
    expect(resolveUpdatesTimeoutMs("abc")).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
    expect(resolveUpdatesTimeoutMs("0")).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
    expect(resolveUpdatesTimeoutMs("999")).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
    expect(resolveUpdatesTimeoutMs("60001")).toBe(DEFAULT_STATION_UPDATES_TIMEOUT_MS);
  });

  it("aceita valores válidos dentro da janela [1000, 60000]", () => {
    expect(resolveUpdatesTimeoutMs("14000")).toBe(14000);
    expect(resolveUpdatesTimeoutMs("20000")).toBe(20000);
    expect(resolveUpdatesTimeoutMs("60000")).toBe(60000);
  });
});
