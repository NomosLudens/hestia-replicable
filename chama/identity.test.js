import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs";
import { tmpdir } from "node:os";
import { getIdentity } from "./identity.js";

describe("getIdentity", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await new Promise((resolve, reject) =>
      mkdtemp(join(tmpdir(), "hestia-identity-"), (err, dir) => {
        if (err) reject(err);
        else resolve(dir);
      }),
    );
    // Garante o subdiretório
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("cria e persiste identity.json na primeira chamada", async () => {
    const id1 = await getIdentity(tmpDir);
    expect(id1.id).toBeDefined();
    expect(id1.createdAt).toBeDefined();
    expect(id1.machine).toBeDefined();
    expect(id1.machine.gpu).toBe(null);

    // Verifica que foi gravado
    const content = await fs.readFile(join(tmpDir, "identity.json"), "utf8");
    const persisted = JSON.parse(content);
    expect(persisted.id).toBe(id1.id);
    expect(persisted.createdAt).toBe(id1.createdAt);
  });

  it("reutiliza id e createdAt na segunda chamada", async () => {
    const id1 = await getIdentity(tmpDir);
    const id2 = await getIdentity(tmpDir);

    expect(id2.id).toBe(id1.id);
    expect(id2.createdAt).toBe(id1.createdAt);
  });

  it("sempre retorna machine.gpu como null", async () => {
    const identity = await getIdentity(tmpDir);
    expect(identity.machine.gpu).toBe(null);
  });

  it("computa machine ao vivo (hostname, platform, arch, cpus, totalMemory)", async () => {
    const identity = await getIdentity(tmpDir);
    expect(typeof identity.machine.hostname).toBe("string");
    expect(typeof identity.machine.platform).toBe("string");
    expect(typeof identity.machine.arch).toBe("string");
    expect(typeof identity.machine.cpus).toBe("number");
    expect(typeof identity.machine.totalMemory).toBe("number");
  });
});
