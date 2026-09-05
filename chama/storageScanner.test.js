import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs";
import { tmpdir } from "node:os";
import { scanPath, DEFAULT_INDEX_LIMITS } from "./storageScanner.js";

async function makeTmpDir(prefix) {
  return new Promise((resolve, reject) =>
    mkdtemp(join(tmpdir(), prefix), (err, dir) => (err ? reject(err) : resolve(dir))),
  );
}

describe("scanPath", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir("hestia-scanner-");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("retorna exists:false para path inexistente, sem lançar", async () => {
    const result = await scanPath(join(tmpDir, "nao-existe"));
    expect(result.exists).toBe(false);
    expect(result.files).toBe(0);
    expect(result.safeErrors).toHaveLength(1);
    expect(result.safeErrors[0].code).toBe("ENOENT");
  });

  it("conta arquivos, bytes e extensões corretamente", async () => {
    await fs.writeFile(join(tmpDir, "a.pdf"), "conteudo-pdf");
    await fs.writeFile(join(tmpDir, "b.pdf"), "outro-conteudo-pdf-maior");
    await fs.writeFile(join(tmpDir, "c.txt"), "x");

    const result = await scanPath(tmpDir);
    expect(result.exists).toBe(true);
    expect(result.files).toBe(3);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.extensions[".pdf"]).toBe(2);
    expect(result.extensions[".txt"]).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("varre subpastas recursivamente", async () => {
    await fs.mkdir(join(tmpDir, "sub", "sub2"), { recursive: true });
    await fs.writeFile(join(tmpDir, "raiz.jpg"), "x");
    await fs.writeFile(join(tmpDir, "sub", "nivel1.jpg"), "x");
    await fs.writeFile(join(tmpDir, "sub", "sub2", "nivel2.jpg"), "x");

    const result = await scanPath(tmpDir);
    expect(result.files).toBe(3);
    expect(result.extensions[".jpg"]).toBe(3);
  });

  it("varre profundidade prática sem truncar", async () => {
    const mid = join(tmpDir, ...Array.from({ length: 5 }, (_, i) => `m${i}`));
    const deep = join(tmpDir, ...Array.from({ length: 10 }, (_, i) => `n${i}`));
    await fs.mkdir(mid, { recursive: true });
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(join(tmpDir, "nivel1.pdf"), "x");
    await fs.writeFile(join(mid, "nivel5.mp4"), "x");
    await fs.writeFile(join(deep, "nivel10.mkv"), "x");

    const result = await scanPath(tmpDir);
    expect(result.truncated).toBe(false);
    expect(result.files).toBe(3);
    expect(result.extensions[".mp4"]).toBe(1);
    expect(result.extensions[".mkv"]).toBe(1);
  });

  it("mantém diretórios de segurança ignorados fora da varredura", async () => {
    await fs.mkdir(join(tmpDir, "node_modules"), { recursive: true });
    await fs.mkdir(join(tmpDir, ".git"), { recursive: true });
    await fs.writeFile(join(tmpDir, "entrada.pdf"), "x");
    await fs.writeFile(join(tmpDir, "node_modules", "lib.js"), "x");
    await fs.writeFile(join(tmpDir, ".git", "config"), "x");

    const result = await scanPath(tmpDir);
    expect(result.files).toBe(1);
    expect(result.ignored).toBe(2);
  });

  it("marca truncated:true com reason maxFiles ao bater o limite", async () => {
    await fs.writeFile(join(tmpDir, "a.txt"), "x");
    await fs.writeFile(join(tmpDir, "b.txt"), "x");
    await fs.writeFile(join(tmpDir, "c.txt"), "x");

    const result = await scanPath(tmpDir, { maxDepth: 4, maxFiles: 2 });
    expect(result.truncated).toBe(true);
    expect(result.reason).toBe("maxFiles");
    expect(result.files).toBe(2);
  });

  it("marca truncated:true com reason maxDepth ao exceder profundidade", async () => {
    await fs.mkdir(join(tmpDir, "a", "b", "c"), { recursive: true });
    await fs.writeFile(join(tmpDir, "a", "b", "c", "fundo.txt"), "x");

    const result = await scanPath(tmpDir, { maxDepth: 1, maxFiles: 5000 });
    expect(result.truncated).toBe(true);
    expect(result.reason).toBe("maxDepth");
  });

  it("não segue symlink (não lança e não conta o alvo)", async () => {
    const realDir = join(tmpDir, "real");
    await fs.mkdir(realDir);
    await fs.writeFile(join(realDir, "arquivo.txt"), "x");
    await fs.symlink(realDir, join(tmpDir, "link-para-real"));

    const result = await scanPath(tmpDir);
    // Só o arquivo dentro de "real" é contado; o link não é seguido.
    expect(result.files).toBe(1);
    expect(result.safeErrors).toHaveLength(0);
  });

  it("retorna erro seguro (ENOTDIR) se o path for um arquivo, não uma pasta", async () => {
    const filePath = join(tmpDir, "sou-um-arquivo.txt");
    await fs.writeFile(filePath, "x");

    const result = await scanPath(filePath);
    expect(result.exists).toBe(true);
    expect(result.safeErrors[0].code).toBe("ENOTDIR");
  });

  it("usa DEFAULT_INDEX_LIMITS quando nenhum limite é passado", async () => {
    expect(DEFAULT_INDEX_LIMITS).toEqual({ maxDepth: 12, maxFiles: 5000 });
  });
});

describe("scanStorageModel", () => {
  it("varre todas as pastas do modelo canônico sem lançar (mesmo sem /KALINE existir)", async () => {
    const { scanStorageModel } = await import("./storageScanner.js");
    const result = await scanStorageModel();
    expect(result.root).toBe("/KALINE");
    expect(Array.isArray(result.folders)).toBe(true);
    expect(result.folders.length).toBeGreaterThan(0);
    for (const folder of result.folders) {
      expect(typeof folder.exists).toBe("boolean");
    }
  });
});

describe("scanConfiguredSources", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await makeTmpDir("hestia-scanner-sources-");
    await fs.writeFile(join(tmpDir, "filme.mp4"), "x");
  });

  afterEach(async () => {
    vi.resetModules();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("varre as fontes configuradas em config.storageSources", async () => {
    vi.resetModules();
    vi.doMock("./config.js", () => ({
      config: {
        storageSources: [
          {
            id: "filmes-hd",
            label: "Filmes do HD",
            path: tmpDir,
            category: "midia/videos",
            mode: "external-readonly",
          },
        ],
      },
    }));
    const { scanConfiguredSources } = await import("./storageScanner.js");

    const result = await scanConfiguredSources();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "filmes-hd",
      label: "Filmes do HD",
      category: "midia/videos",
      mode: "external-readonly",
      exists: true,
      files: 1,
      bytes: 1,
      extensions: { ".mp4": 1 },
    });
    expect(result.items[0]).not.toHaveProperty("entries");
    expect(result.items[0]).not.toHaveProperty("filme.mp4");
    expect(JSON.stringify(result.items[0])).not.toContain("filme.mp4");

    vi.doUnmock("./config.js");
  });

  it("mantém fonte desmontada configurada no scan com exists:false", async () => {
    const missingPath = join(tmpDir, "desmontada");
    vi.resetModules();
    vi.doMock("./config.js", () => ({
      config: {
        storageSources: [
          {
            id: "hd-ausente",
            label: "HD ausente",
            path: missingPath,
            category: "midia/videos",
            mode: "external-readonly",
          },
        ],
      },
    }));
    const { scanConfiguredSources } = await import("./storageScanner.js");

    const result = await scanConfiguredSources();
    expect(result.items[0]).toMatchObject({
      id: "hd-ausente",
      label: "HD ausente",
      exists: false,
      files: 0,
    });

    vi.doUnmock("./config.js");
  });
});
