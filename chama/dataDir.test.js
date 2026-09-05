import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveDataDir, ensureDataDir } from "./dataDir.js";

describe("resolveDataDir", () => {
  it("prioriza HESTIA_DATA_DIR sobre tudo", () => {
    const dir = resolveDataDir({
      HESTIA_DATA_DIR: "/custom/data",
      STATE_DIRECTORY: "/var/lib/hestia-console",
      HOME: "/home/x",
    });
    expect(dir).toBe("/custom/data");
  });

  it("usa STATE_DIRECTORY (systemd) quando HESTIA_DATA_DIR não está setado", () => {
    const dir = resolveDataDir({ STATE_DIRECTORY: "/var/lib/hestia-console", HOME: "/home/x" });
    expect(dir).toBe("/var/lib/hestia-console");
  });

  it("usa só o primeiro diretório se STATE_DIRECTORY tiver múltiplos separados por ':'", () => {
    const dir = resolveDataDir({ STATE_DIRECTORY: "/var/lib/a:/var/lib/b", HOME: "/home/x" });
    expect(dir).toBe("/var/lib/a");
  });

  it("cai para <homedir>/.chama/data quando nada está setado", () => {
    const dir = resolveDataDir({}, () => "/home/x");
    expect(dir.replace(/\\/g, "/")).toBe("/home/x/.chama/data");
  });
});

describe("ensureDataDir", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cria dataDir, events/, snapshots/ e organizer/plans+runs/", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hestia-datadir-"));
    const dataDir = join(tmpDir, "data");
    ensureDataDir(dataDir);

    expect(existsSync(join(dataDir, "events"))).toBe(true);
    expect(existsSync(join(dataDir, "snapshots"))).toBe(true);
    expect(existsSync(join(dataDir, "organizer", "plans"))).toBe(true);
    expect(existsSync(join(dataDir, "organizer", "runs"))).toBe(true);
  });
});
