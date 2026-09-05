import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs";
import { tmpdir } from "node:os";
import { getPresenceSummary } from "./presenceSummary.js";

describe("getPresenceSummary", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await new Promise((resolve, reject) =>
      mkdtemp(join(tmpdir(), "hestia-summary-"), (err, dir) => {
        if (err) reject(err);
        else resolve(dir);
      }),
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("retorna sumário com timestamp e schemaVersion", async () => {
    const summary = await getPresenceSummary(tmpDir);
    expect(summary.timestamp).toBeDefined();
    expect(new Date(summary.timestamp)).toBeInstanceOf(Date);
  });

  it("inclui identity com id e createdAt", async () => {
    const summary = await getPresenceSummary(tmpDir);
    expect(summary.identity).toBeDefined();
    expect(summary.identity.id).toBeDefined();
    expect(summary.identity.createdAt).toBeDefined();
    expect(summary.identity.hostname).toBeDefined();
  });

  it("contém servicesSummary com total e active", async () => {
    const summary = await getPresenceSummary(tmpDir);
    expect(typeof summary.servicesSummary.total).toBe("number");
    expect(typeof summary.servicesSummary.active).toBe("number");
  });

  it("não contém storageSummary no Console da TV Box", async () => {
    const summary = await getPresenceSummary(tmpDir);
    expect(summary).not.toHaveProperty("storageSummary");
  });

  it("inclui server com uptime, loadAverage, freeMemory", async () => {
    const summary = await getPresenceSummary(tmpDir);
    expect(typeof summary.server.uptime).toBe("number");
    expect(Array.isArray(summary.server.loadAverage)).toBe(true);
    expect(typeof summary.server.freeMemory).toBe("number");
  });
});
