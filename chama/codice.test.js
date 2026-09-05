import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

import {
  getCodiceHealth,
  getCodiceLibrary,
  resolveCodiceBook,
  clearCodiceCache,
  getBookHeaders,
} from "./codice.js";

describe("Códice API", () => {
  let tempDir;

  beforeEach(() => {
    clearCodiceCache();
  });

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-codice-test-"));
    // Cria a estrutura
    await fs.mkdir(path.join(tempDir, "codice/epub"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "codice/pdf"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "codice/txt"), { recursive: true });

    // Cria alguns arquivos fictícios
    await fs.writeFile(path.join(tempDir, "codice/epub/test1.epub"), "dummy epub");
    await fs.writeFile(path.join(tempDir, "codice/pdf/test2.pdf"), "dummy pdf");
    await fs.writeFile(path.join(tempDir, "codice/txt/test3.txt"), "dummy txt");
    await fs.writeFile(path.join(tempDir, "codice/epub/.hidden.epub"), "hidden");
    await fs.writeFile(path.join(tempDir, "codice/pdf/invalid.jpg"), "invalid");
  });

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should return health ok when folders exist", async () => {
    const health = await getCodiceHealth(tempDir);
    expect(health.ok).toBe(true);
    expect(health.libraryAvailable).toBe(true);
  });

  it("should fail health if epub/pdf missing", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-codice-test-fail-"));
    await expect(getCodiceHealth(emptyDir)).rejects.toThrow("CODICE_LIBRARY_UNAVAILABLE");
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it("should index valid books and ignore hidden/invalid formats", async () => {
    const library = await getCodiceLibrary(tempDir);
    expect(library.schemaVersion).toBe(1);
    expect(library.books.length).toBe(3);

    const formats = library.books.map((b) => b.format).sort();
    expect(formats).toEqual(["epub", "pdf", "txt"]);

    // Check if internal fields were stripped
    const book = library.books[0];
    expect(book).not.toHaveProperty("_fullPath");
    expect(book).not.toHaveProperty("_relPath");
  });

  it("should resolve a valid book by ID", async () => {
    const library = await getCodiceLibrary(tempDir);
    const book = library.books.find((b) => b.format === "epub");

    const resolved = await resolveCodiceBook(tempDir, book.id);
    expect(resolved).not.toBeNull();
    expect(resolved.mimeType).toBe("application/epub+zip");
    expect(resolved.filename).toBe(book.name);
  });

  it("should refuse to resolve invalid book ID", async () => {
    const resolved = await resolveCodiceBook(tempDir, "invalid-id");
    expect(resolved).toBeNull();
  });

  it("lança erro se readdir falhar por falta de permissão (EACCES)", async () => {
    const spy = vi
      .spyOn(fs, "readdir")
      .mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    try {
      await getCodiceLibrary(tempDir);
      throw new Error("Deveria ter falhado");
    } catch (err) {
      expect(err.code).toBe("EACCES");
    } finally {
      spy.mockRestore();
    }
  });

  it("lança erro se lstat falhar com erro de I/O (EIO)", async () => {
    const spy = vi
      .spyOn(fs, "lstat")
      .mockRejectedValueOnce(Object.assign(new Error("EIO"), { code: "EIO" }));
    try {
      await getCodiceLibrary(tempDir);
      throw new Error("Deveria ter falhado");
    } catch (err) {
      expect(err.code).toBe("EIO");
    } finally {
      spy.mockRestore();
    }
  });

  it("ignora e continua se o arquivo sumir (ENOENT) entre readdir e lstat", async () => {
    const spy = vi
      .spyOn(fs, "lstat")
      .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    try {
      const library = await getCodiceLibrary(tempDir);
      // Deve ignorar o arquivo removido e retornar os outros 2
      expect(library.books.length).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("health check falha se a pasta não for legível (sem permissão de leitura)", async () => {
    const spy = vi
      .spyOn(fs, "access")
      .mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    try {
      await getCodiceHealth(tempDir);
      throw new Error("Deveria ter falhado");
    } catch (err) {
      expect(err.code).toBe("ECODICELIBRARY");
    } finally {
      spy.mockRestore();
    }
  });

  it("health e library falham com ECODICELIBRARY se epub/pdf estiverem ausentes ou ilegíveis", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-codice-missing-"));
    try {
      await expect(getCodiceHealth(emptyDir)).rejects.toMatchObject({ code: "ECODICELIBRARY" });
      await expect(getCodiceLibrary(emptyDir)).rejects.toMatchObject({ code: "ECODICELIBRARY" });
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("formats reflete apenas pastas existentes e legíveis no health check", async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-codice-formats-"));
    try {
      await fs.mkdir(path.join(testDir, "codice/epub"), { recursive: true });
      await fs.mkdir(path.join(testDir, "codice/pdf"), { recursive: true });

      const health1 = await getCodiceHealth(testDir);
      expect(health1.formats).toEqual(["epub", "pdf"]);

      await fs.mkdir(path.join(testDir, "codice/txt"), { recursive: true });
      const health2 = await getCodiceHealth(testDir);
      expect(health2.formats).toEqual(["epub", "pdf", "txt"]);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("generatedAt do cache permanece idêntico em cache hits e muda ao expirar", async () => {
    clearCodiceCache();
    const lib1 = await getCodiceLibrary(tempDir);
    const genAt1 = lib1.generatedAt;

    const spyNow = vi.spyOn(Date, "now");
    const startTime = Date.now();
    spyNow.mockReturnValue(startTime + 1000);

    const lib2 = await getCodiceLibrary(tempDir);
    expect(lib2.generatedAt).toBe(genAt1);

    spyNow.mockReturnValue(startTime + 6000);
    const lib3 = await getCodiceLibrary(tempDir);
    expect(lib3.generatedAt).not.toBe(genAt1);

    spyNow.mockRestore();
  });

  it("filename* codifica corretamente caracteres especiais exigidos por RFC 5987", () => {
    const headers = getBookHeaders({
      filename: "livro 'teste' (completo) *.pdf",
      mimeType: "application/pdf",
      stat: { size: 100, mtime: new Date() },
    });
    const cd = headers["Content-Disposition"];
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain("%27teste%27");
    expect(cd).toContain("%28completo%29");
    expect(cd).toContain("%2A");
  });
});
