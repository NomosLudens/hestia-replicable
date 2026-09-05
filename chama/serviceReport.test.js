import { describe, it, expect, vi, beforeEach } from "vitest";

const execFile = vi.fn();

vi.mock("node:child_process", () => ({ default: { execFile }, execFile }));

const { __internals, getStationServicesReport } = await import("./serviceReport.js");

const NOW_ISO = "2026-08-22T15:00:00.000Z";
const NOW_DATE = new Date(NOW_ISO);

beforeEach(() => {
  execFile.mockReset();
});

describe("parseListUnitFiles", () => {
  it("extrai TODOS os *.service mesmo sem cabeçalho (--no-legend --plain)", () => {
    const input = [
      "alsa-restore.service                         static          -",
      "alsa-state.service                           static          -",
      "rc-local.service generated enabled",
      "not-a-service.timer static -",
      "",
    ].join("\n");
    const out = __internals.parseListUnitFiles(input);
    expect(out).toEqual([
      { unit: "alsa-restore.service", state: "static", preset: "-" },
      { unit: "alsa-state.service", state: "static", preset: "-" },
      { unit: "rc-local.service", state: "generated", preset: "enabled" },
    ]);
  });

  it("ignora o cabeçalho 'UNIT FILE STATE PRESET' quando presente", () => {
    const input = [
      "UNIT FILE STATE PRESET",
      "alsa-restore.service static -",
      "alsa-state.service   static -",
      "rc-local.service generated enabled",
      "   ",
    ].join("\n");
    const out = __internals.parseListUnitFiles(input);
    expect(out).toEqual([
      { unit: "alsa-restore.service", state: "static", preset: "-" },
      { unit: "alsa-state.service", state: "static", preset: "-" },
      { unit: "rc-local.service", state: "generated", preset: "enabled" },
    ]);
  });

  it("devolve lista vazia para stdout vazio", () => {
    expect(__internals.parseListUnitFiles("")).toEqual([]);
    expect(__internals.parseListUnitFiles("\n\n\n")).toEqual([]);
  });
});

describe("parseSystemctlShow", () => {
  it("lê pares key=value uma única vez por chave", () => {
    const stdout = [
      "Id=foo.service",
      "Id=ignored-duplicate",
      "ActiveState=active",
      "SubState=running",
      "MemoryCurrent=2048",
      "",
    ].join("\n");
    expect(__internals.parseSystemctlShow(stdout)).toEqual({
      Id: "foo.service",
      ActiveState: "active",
      SubState: "running",
      MemoryCurrent: "2048",
    });
  });
});

describe("buildServiceReport", () => {
  it("preenche campos com valores reais e marca explicitamente os ausentes", () => {
    const props = {
      Id: "foo.service",
      Description: "Foo",
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "running",
      UnitFileState: "enabled",
      MainPID: "1234",
      ExecMainPID: "1234",
      ExecMainStatus: "0",
      NRestarts: "0",
      ActiveEnterTimestamp: "Sat 2026-08-22 09:00:00 -03",
      ActiveExitTimestamp: "",
      MemoryCurrent: "[not set]",
      CPUUsageNSec: "2048",
      FragmentPath: "/etc/systemd/system/foo.service",
      Result: "success",
      Type: "simple",
      Restart: "no",
    };
    const out = __internals.buildServiceReport("foo.service", "enabled", props, NOW_ISO);
    expect(out.unit).toBe("foo.service");
    expect(out.description).toBe("Foo");
    expect(out.activeState).toBe("active");
    expect(out.mainPid).toBe(1234);
    expect(out.execMainPid).toBe(1234);
    expect(out.memoryCurrentBytes).toBeNull();
    expect(out.fieldsUnknown).toContain("memoryCurrentBytes");
    expect(out.fieldsUnknown).toContain("activeExitTimestamp");
    expect(out.fieldsUnknown).not.toContain("description");
    expect(out.uptimeSeconds).toBe(10800); // 09:00 -03 = 12:00 UTC => 3h
  });

  it("devolve unknown explícito quando loadState/activeState estiverem ausentes", () => {
    const out = __internals.buildServiceReport(
      "missing.service",
      "-",
      { Id: "missing.service" },
      NOW_ISO,
    );
    expect(out.unitFileState).toBe("unknown");
    expect(out.activeState).toBe("unknown");
    expect(out.mainPid).toBeNull();
    expect(out.fieldsUnknown.length).toBeGreaterThan(5);
  });
});

describe("summarize", () => {
  it("agrega contagens por activeState e unitFileState", () => {
    const summary = __internals.summarize([
      __internals.buildServiceReport(
        "a.service",
        "enabled",
        { ActiveState: "active", UnitFileState: "enabled" },
        NOW_ISO,
      ),
      __internals.buildServiceReport(
        "b.service",
        "disabled",
        { ActiveState: "failed", UnitFileState: "enabled" },
        NOW_ISO,
      ),
      __internals.buildServiceReport(
        "c.service",
        "-",
        { ActiveState: "inactive", UnitFileState: "disabled" },
        NOW_ISO,
      ),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byActiveState.active).toBe(1);
    expect(summary.byActiveState.failed).toBe(1);
    expect(summary.byActiveState.inactive).toBe(1);
    expect(summary.byUnitFileState.enabled).toBe(2);
    expect(summary.byUnitFileState.disabled).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.enabledDisabled).toEqual({ enabled: 2, disabled: 1 });
  });
});

describe("getStationServicesReport", () => {
  it("enumera dinamicamente TODOS os *.service via systemctl real (sem whitelist)", async () => {
    let callCount = 0;
    execFile.mockImplementation((_cmd, args, _opts, cb) => {
      callCount += 1;
      if (callCount === 1) {
        cb(null, "UNIT FILE STATE PRESET\nfoo.service static -\nbar.service enabled enabled\n", "");
        return;
      }
      const unit = args[1];
      cb(
        null,
        [
          `Id=${unit}`,
          `Description=${unit} description`,
          "LoadState=loaded",
          "ActiveState=inactive",
          "SubState=dead",
          "UnitFileState=static",
          "MainPID=0",
          "ExecMainPID=0",
          "ExecMainStatus=0",
          "NRestarts=0",
          "ActiveEnterTimestamp=",
          "ActiveExitTimestamp=",
          "MemoryCurrent=",
          "CPUUsageNSec=",
          "FragmentPath=/etc/systemd/system/" + unit,
          "Result=success",
          "",
        ].join("\n"),
      );
    });

    vi.useFakeTimers();
    vi.setSystemTime(NOW_DATE);
    try {
      const report = await getStationServicesReport();
      expect(report.count).toBe(2);
      expect(report.generatedAt).toBe(NOW_ISO);
      expect(report.services.map((s) => s.unit)).toEqual(["bar.service", "foo.service"]);
      expect(report.summary.total).toBe(2);
      // Invariante: nenhuma chamada aceita nome vindo de fora — `systemctl
      // list-unit-files` é o ÚNICO input.
      const listCalls = execFile.mock.calls.filter((c) => c[1][0] === "list-unit-files");
      expect(listCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("captura erro de systemctl show em uma unidade sem derrubar o inventário", async () => {
    let callCount = 0;
    execFile.mockImplementation((_cmd, args, _opts, cb) => {
      callCount += 1;
      if (callCount === 1) {
        cb(null, "UNIT FILE STATE PRESET\nboom.service static -\nok.service enabled enabled\n", "");
        return;
      }
      const unit = args[1];
      if (unit === "boom.service") {
        const err = new Error("show failed");
        err.code = "ENOENT";
        cb(err, "", "stderr boom");
        return;
      }
      cb(
        null,
        [
          "Id=" + unit,
          "Description=" + unit,
          "LoadState=loaded",
          "ActiveState=inactive",
          "SubState=dead",
          "UnitFileState=enabled",
          "MainPID=0",
          "ExecMainPID=0",
          "ExecMainStatus=0",
          "NRestarts=0",
          "ActiveEnterTimestamp=",
          "ActiveExitTimestamp=",
          "MemoryCurrent=",
          "CPUUsageNSec=",
          "FragmentPath=/etc/systemd/system/" + unit,
          "Result=success",
          "",
        ].join("\n"),
      );
    });

    const report = await getStationServicesReport();
    expect(report.count).toBe(2);
    const boom = report.services.find((s) => s.unit === "boom.service");
    expect(boom).toBeTruthy();
    expect(boom.error).not.toBeNull();
    expect(boom.error.code).toBe("ENOENT");
  });

  it("NÃO usa whitelist — qualquer *.service é incluído", async () => {
    let callCount = 0;
    execFile.mockImplementation((_cmd, args, _opts, cb) => {
      callCount += 1;
      if (callCount === 1) {
        cb(
          null,
          "UNIT FILE STATE PRESET\nblackbox.service static -\nexperience.service static -\nwitness.service static -\ntor.service static -\nyggdrasil.service static -\nkallistis-absorber.service static -\nrandom-unknown.service static -\n",
          "",
        );
        return;
      }
      const unit = args[1];
      cb(
        null,
        [
          "Id=" + unit,
          "Description=" + unit,
          "LoadState=loaded",
          "ActiveState=inactive",
          "SubState=dead",
          "UnitFileState=static",
          "MainPID=0",
          "ExecMainPID=0",
          "ExecMainStatus=0",
          "NRestarts=0",
          "ActiveEnterTimestamp=",
          "ActiveExitTimestamp=",
          "MemoryCurrent=",
          "CPUUsageNSec=",
          "FragmentPath=/etc/systemd/system/" + unit,
          "Result=success",
          "",
        ].join("\n"),
      );
    });
    const report = await getStationServicesReport();
    expect(report.count).toBe(7);
    const names = report.services.map((s) => s.unit).sort();
    expect(names).toEqual([
      "blackbox.service",
      "experience.service",
      "kallistis-absorber.service",
      "random-unknown.service",
      "tor.service",
      "witness.service",
      "yggdrasil.service",
    ]);
  });
});
