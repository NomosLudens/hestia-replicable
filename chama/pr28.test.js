import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import Fastify from "fastify";

import {
  getCodiceHealth,
  getCodiceLibrary,
  resolveCodiceBook,
  getBookHeaders,
  clearCodiceCache,
} from "./codice.js";
import { registerCodiceRoutes } from "./codiceRoutes.js";

async function makeTmpDir(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("PR #28 - Codice and Organizer Security Contracts", () => {
  let workDir;
  let dataDir;

  beforeEach(async () => {
    clearCodiceCache();
    workDir = await makeTmpDir("hestia-pr28-work-");
    process.env.HESTIA_STORAGE_PATH = workDir;
    dataDir = await makeTmpDir("hestia-pr28-data-");
    await fs.mkdir(path.join(dataDir, "events"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "organizer", "plans"), { recursive: true });

    // Setup codice directories
    await fs.mkdir(path.join(workDir, "codice/epub"), { recursive: true });
    await fs.mkdir(path.join(workDir, "codice/pdf"), { recursive: true });
    await fs.mkdir(path.join(workDir, "codice/txt"), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.HESTIA_STORAGE_PATH;
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("Códice Security", () => {
    it("valida health check de acordo com presença de pastas essenciais", async () => {
      const health = await getCodiceHealth(workDir);
      expect(health.ok).toBe(true);
      expect(health.libraryAvailable).toBe(true);

      const emptyDir = await makeTmpDir("hestia-pr28-empty-");
      await expect(getCodiceHealth(emptyDir)).rejects.toThrow("CODICE_LIBRARY_UNAVAILABLE");
      await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    });

    it("filtra dotfiles, formatos inválidos, limita recursão/profundidade e não vaza caminhos internos", async () => {
      // 1. Arquivos válidos
      await fs.writeFile(path.join(workDir, "codice/epub/livro.epub"), "epub content");
      await fs.writeFile(path.join(workDir, "codice/pdf/doc.pdf"), "pdf content");
      await fs.writeFile(path.join(workDir, "codice/txt/readme.txt"), "txt content");

      // 2. Arquivos inválidos/dotfiles
      await fs.writeFile(path.join(workDir, "codice/epub/.hidden.epub"), "hidden");
      await fs.writeFile(path.join(workDir, "codice/pdf/image.png"), "png"); // ext desconhecida

      // 3. Profundidade excessiva (MAX_DEPTH = 5)
      let deepDir = path.join(workDir, "codice/epub");
      for (let i = 0; i < 7; i++) {
        deepDir = path.join(deepDir, `sub_${i}`);
        await fs.mkdir(deepDir, { recursive: true });
      }
      await fs.writeFile(path.join(deepDir, "deep.epub"), "too deep");

      const library = await getCodiceLibrary(workDir);
      expect(library.books.length).toBe(3); // livro, doc, readme

      const titles = library.books.map((b) => b.title);
      expect(titles).toContain("livro");
      expect(titles).toContain("doc");
      expect(titles).toContain("readme");
      expect(titles).not.toContain("deep");
      expect(titles).not.toContain(".hidden");

      // Prova que campos internos não são vazados na biblioteca pública
      for (const book of library.books) {
        expect(book._fullPath).toBeUndefined();
        expect(book._relPath).toBeUndefined();
        // ID deve ser sha256 base64url do relPath
        expect(book.id).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    it("rejeita symlinks e escapes de diretório usando resolveCodiceBook", async () => {
      // Cria arquivo real
      await fs.writeFile(path.join(workDir, "codice/epub/real.epub"), "real content");
      const library = await getCodiceLibrary(workDir);
      const book = library.books[0];

      // Prova que resolve com sucesso
      const resolved = await resolveCodiceBook(workDir, book.id);
      expect(resolved).not.toBeNull();
      expect(resolved.filename).toBe("real.epub");

      // Cria symlink apontando para arquivo fora da raiz
      const outsideFile = path.join(os.tmpdir(), "outside.epub");
      await fs.writeFile(outsideFile, "outside content");
      const symlinkPath = path.join(workDir, "codice/epub/sym.epub");
      await fs.symlink(outsideFile, symlinkPath);

      // Limpa cache gerando biblioteca de novo
      clearCodiceCache();
      const library2 = await getCodiceLibrary(workDir);
      const symBook = library2.books.find((b) => b.name === "sym.epub");
      // O indexador já deve ignorar symlinks
      expect(symBook).toBeUndefined();

      // Limpa arquivo fora do temporário
      await fs.unlink(outsideFile).catch(() => {});
    });

    it("gera headers corretos: Weak ETag estável e Content-Disposition com RFC 5987", async () => {
      const resolved = {
        fullPath: "/some/path/doc.pdf",
        mimeType: "application/pdf",
        stat: {
          size: 1024,
          mtime: new Date("2026-07-13T00:00:00.000Z"),
        },
        filename: "Livro de Héstia & Códice.pdf",
      };

      const headers = getBookHeaders(resolved);
      expect(headers["Content-Type"]).toBe("application/pdf");
      expect(headers["Content-Length"]).toBe("1024");

      const expectedEtag = `W/"1024-${resolved.stat.mtime.getTime()}"`;
      expect(headers["ETag"]).toBe(expectedEtag);
      expect(headers["Cache-Control"]).toBe("private, no-store");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");

      // Content-Disposition format
      const cd = headers["Content-Disposition"];
      expect(cd).toContain('filename="Livro de H_stia & C_dice.pdf"'); // ASCII sanitizado, & preservado
      expect(cd).toContain("filename*=UTF-8''Livro%20de%20H%C3%A9stia%20%26%20C%C3%B3dice.pdf"); // RFC 5987 UTF-8
    });

    it("valida rotas HTTP reais do Códice usando Fastify inject", async () => {
      const app = Fastify();
      registerCodiceRoutes(app, { storageRoot: workDir });

      // 1. Testa health
      const resHealth = await app.inject({
        method: "GET",
        url: "/api/codice/health",
      });
      expect(resHealth.statusCode).toBe(200);
      const healthData = JSON.parse(resHealth.payload);
      expect(healthData.ok).toBe(true);

      // 2. Cria livros
      await fs.writeFile(path.join(workDir, "codice/epub/test.epub"), "epub book");

      // 3. Testa library
      const resLib = await app.inject({
        method: "GET",
        url: "/api/codice/library",
      });
      expect(resLib.statusCode).toBe(200);
      const libData = JSON.parse(resLib.payload);
      expect(libData.books.length).toBe(1);
      const book = libData.books[0];
      expect(book.name).toBe("test.epub");

      // 4. Testa HEAD livro
      const resHead = await app.inject({
        method: "HEAD",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resHead.statusCode).toBe(200);
      expect(resHead.headers["content-type"]).toBe("application/epub+zip");
      expect(resHead.headers["content-length"]).toBe("9");
      expect(resHead.headers["etag"]).toContain('W/"9-');

      // 5. Testa GET livro
      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resGet.statusCode).toBe(200);
      expect(resGet.payload).toBe("epub book");

      // 6. Testa wildcard rota inexistente
      const res404 = await app.inject({
        method: "GET",
        url: "/api/codice/invalid-endpoint-abc",
      });
      expect(res404.statusCode).toBe(404);

      // 7. Testa wildcard método inválido (POST na library)
      const res405 = await app.inject({
        method: "POST",
        url: "/api/codice/library",
      });
      expect(res405.statusCode).toBe(405);
    });
  });

  it("GET livro com erro de leitura (arquivo removido antes de abrir) retorna 503 controlado sem vazar paths", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const bookPath = path.join(workDir, "codice/epub/removido.epub");
    await fs.writeFile(bookPath, "conteudo temporario");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "removido.epub");
    expect(book).toBeDefined();

    const realOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      if (file === bookPath) {
        const err = new Error("simulated open failure");
        err.code = "EACCES";
        throw err;
      }
      return await realOpen(file, flags, mode);
    });

    try {
      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });

      expect(resGet.statusCode).toBe(503);
      const payload = JSON.parse(resGet.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("CODICE_BOOK_UNAVAILABLE");

      const strPayload = JSON.stringify(payload);
      expect(strPayload).not.toContain("removido.epub");
      expect(strPayload).not.toContain(workDir);
      expect(strPayload).not.toContain("/KALINE");
      expect(strPayload).not.toContain("tonyus-dev");
    } finally {
      openSpy.mockRestore();
    }
  });

  it("GET livro com O_NOFOLLOW recusa e falha com 503 quando o arquivo foi substituído por symlink", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const realFilePath = path.join(workDir, "codice/epub/symlink-target.epub");
    await fs.writeFile(realFilePath, "livro legitimo");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "symlink-target.epub");
    expect(book).toBeDefined();

    const externalPath = path.join(os.tmpdir(), "pr28-external-content.txt");
    await fs.writeFile(externalPath, "conteudo secreto fora da raiz");

    const originalLstat = fs.lstat;
    const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (path) => {
      if (path === realFilePath) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          size: 14,
          mtime: new Date(),
        };
      }
      return originalLstat(path);
    });

    const originalRealpath = fs.realpath;
    const realpathSpy = vi.spyOn(fs, "realpath").mockImplementation(async (path) => {
      if (path === realFilePath) {
        return realFilePath;
      }
      return originalRealpath(path);
    });

    await fs.unlink(realFilePath);
    await fs.symlink(externalPath, realFilePath);

    try {
      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });

      expect(resGet.statusCode).toBe(503);
      const payload = JSON.parse(resGet.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("CODICE_BOOK_UNAVAILABLE");

      expect(resGet.payload).not.toContain("conteudo secreto fora da raiz");
      expect(resGet.payload).not.toContain(workDir);
      expect(resGet.payload).not.toContain("pr28-external-content.txt");
    } finally {
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
      await fs.unlink(realFilePath).catch(() => {});
      await fs.unlink(externalPath).catch(() => {});
    }
  });

  describe("Mapeamento de Erros da Biblioteca para 503", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      clearCodiceCache();
    });

    const unavailabilityCodes = ["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE", "ESTALE", "ENODEV"];

    unavailabilityCodes.forEach((code) => {
      it(`retorna HTTP 503 com CODICE_LIBRARY_UNAVAILABLE para erro de disco ${code}`, async () => {
        const app = Fastify();
        registerCodiceRoutes(app, { storageRoot: workDir });

        const spy = vi
          .spyOn(fs, "readdir")
          .mockRejectedValue(Object.assign(new Error(code), { code }));

        const res = await app.inject({
          method: "GET",
          url: "/api/codice/library",
        });

        expect(res.statusCode).toBe(503);
        const payload = JSON.parse(res.payload);
        expect(payload.ok).toBe(false);
        expect(payload.code).toBe("CODICE_LIBRARY_UNAVAILABLE");
      });
    });

    it("retorna HTTP 503 com CODICE_LIBRARY_UNAVAILABLE quando a biblioteca está ausente (ECODICELIBRARY)", async () => {
      const app = Fastify();
      registerCodiceRoutes(app, { storageRoot: workDir });

      const spy = vi
        .spyOn(fs, "access")
        .mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const res = await app.inject({
        method: "GET",
        url: "/api/codice/library",
      });

      expect(res.statusCode).toBe(503);
      const payload = JSON.parse(res.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("CODICE_LIBRARY_UNAVAILABLE");
    });

    it("retorna HTTP 500 para erros desconhecidos na biblioteca", async () => {
      const app = Fastify();
      registerCodiceRoutes(app, { storageRoot: workDir });

      const spy = vi.spyOn(fs, "readdir").mockRejectedValue(new Error("unknown unexpected error"));

      const res = await app.inject({
        method: "GET",
        url: "/api/codice/library",
      });

      expect(res.statusCode).toBe(500);
      const payload = JSON.parse(res.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("INTERNAL_SERVER_ERROR");
      expect(res.payload).not.toContain("unknown unexpected error");
    });
  });

  it("Teste A - HEAD e GET recusam com 503 se o arquivo for substituído por symlink final", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const realFilePath = path.join(workDir, "codice/epub/symlink-race-a.epub");
    await fs.writeFile(realFilePath, "livro original");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "symlink-race-a.epub");
    expect(book).toBeDefined();

    const externalPath = path.join(os.tmpdir(), "symlink-race-a-external.txt");
    await fs.writeFile(externalPath, "conteudo secreto fora");

    const originalLstat = fs.lstat;
    const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (filePath) => {
      if (filePath === realFilePath) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          size: 14,
          mtime: new Date(),
          dev: 1,
          ino: 100,
        };
      }
      return originalLstat(filePath);
    });

    const originalRealpath = fs.realpath;
    const realpathSpy = vi.spyOn(fs, "realpath").mockImplementation(async (filePath) => {
      if (filePath === realFilePath) return realFilePath;
      return originalRealpath(filePath);
    });

    await fs.unlink(realFilePath);
    await fs.symlink(externalPath, realFilePath);

    try {
      const resHead = await app.inject({
        method: "HEAD",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resHead.statusCode).toBe(503);
      const headPayload = JSON.parse(resHead.payload);
      expect(headPayload.ok).toBe(false);
      expect(headPayload.code).toBe("CODICE_BOOK_UNAVAILABLE");

      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resGet.statusCode).toBe(503);
      const payload = JSON.parse(resGet.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("CODICE_BOOK_UNAVAILABLE");
      expect(resGet.payload).not.toContain("conteudo secreto fora");
      expect(resGet.payload).not.toContain(workDir);
    } finally {
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
      await fs.unlink(realFilePath).catch(() => {});
      await fs.unlink(externalPath).catch(() => {});
    }
  });

  it("Teste B - HEAD e GET recusam com 503 se o arquivo for substituído por outro arquivo regular com inode diferente", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const fileAPath = path.join(workDir, "codice/epub/file-a.epub");
    const fileBPath = path.join(workDir, "codice/epub/file-b.epub");

    await fs.writeFile(fileAPath, "conteudo original A");
    await fs.writeFile(fileBPath, "outro conteudo B totalmente diferente");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "file-a.epub");
    expect(book).toBeDefined();

    const originalStat = await fs.stat(fileAPath);
    const oldIno = originalStat.ino;
    const oldDev = originalStat.dev;

    // Substitui A por B usando rename (sobrescreve mantendo o inode de B)
    await fs.rename(fileBPath, fileAPath);

    const originalLstat = fs.lstat;
    const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (filePath) => {
      if (filePath === fileAPath) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          size: 19,
          mtime: new Date(),
          dev: oldDev,
          ino: oldIno,
        };
      }
      return originalLstat(filePath);
    });

    const originalRealpath = fs.realpath;
    const realpathSpy = vi.spyOn(fs, "realpath").mockImplementation(async (filePath) => {
      if (filePath === fileAPath) return fileAPath;
      return originalRealpath(filePath);
    });

    try {
      const resHead = await app.inject({
        method: "HEAD",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resHead.statusCode).toBe(503);

      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });
      expect(resGet.statusCode).toBe(503);
      const payload = JSON.parse(resGet.payload);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("CODICE_BOOK_UNAVAILABLE");
      expect(resGet.payload).not.toContain("outro conteudo B totalmente diferente");
    } finally {
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
      await fs.unlink(fileAPath).catch(() => {});
    }
  });

  it("Teste C - HEAD e GET recusam se o diretório intermediário for trocado", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const subDir = path.join(workDir, "codice/epub/race-dir");
    await fs.mkdir(subDir, { recursive: true });
    const bookPath = path.join(subDir, "book.epub");
    await fs.writeFile(bookPath, "conteudo original no subdir");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "book.epub");
    expect(book).toBeDefined();

    await fs.rm(bookPath).catch(() => {});
    await fs.rmdir(subDir).catch(() => {});

    const externalDir = path.join(os.tmpdir(), "external-race-dir");
    await fs.mkdir(externalDir, { recursive: true }).catch(() => {});
    const externalBook = path.join(externalDir, "book.epub");
    await fs.writeFile(externalBook, "conteudo ultra secreto externo");

    await fs.symlink(externalDir, subDir);

    try {
      const resGet = await app.inject({
        method: "GET",
        url: `/api/codice/books/${book.id}`,
      });
      expect([404, 503]).toContain(resGet.statusCode);
      expect(resGet.payload).not.toContain("conteudo ultra secreto externo");
    } finally {
      await fs.unlink(subDir).catch(() => {});
      await fs.rm(externalDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("Teste D - Paridade de headers entre HEAD e GET", async () => {
    const app = Fastify();
    registerCodiceRoutes(app, { storageRoot: workDir });

    const bookPath = path.join(workDir, "codice/epub/stable.epub");
    await fs.writeFile(bookPath, "livro estavel de teste");

    const resLib = await app.inject({
      method: "GET",
      url: "/api/codice/library",
    });
    const libData = JSON.parse(resLib.payload);
    const book = libData.books.find((b) => b.name === "stable.epub");
    expect(book).toBeDefined();

    const resHead = await app.inject({
      method: "HEAD",
      url: `/api/codice/books/${book.id}`,
    });
    expect(resHead.statusCode).toBe(200);

    const resGet = await app.inject({
      method: "GET",
      url: `/api/codice/books/${book.id}`,
    });
    expect(resGet.statusCode).toBe(200);

    const relevantHeaders = [
      "content-type",
      "content-length",
      "last-modified",
      "etag",
      "content-disposition",
      "cache-control",
      "x-content-type-options",
    ];

    relevantHeaders.forEach((h) => {
      expect(resHead.headers[h]).toBe(resGet.headers[h]);
    });

    await fs.unlink(bookPath).catch(() => {});
  });

  describe("TXT opcional e robustez de formatos", () => {
    it("health e library funcionam com 200 e formats epub/pdf se codice/txt estiver ausente", async () => {
      const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-txt-missing-"));
      try {
        await fs.mkdir(path.join(testDir, "codice/epub"), { recursive: true });
        await fs.mkdir(path.join(testDir, "codice/pdf"), { recursive: true });

        const health = await getCodiceHealth(testDir);
        expect(health.ok).toBe(true);
        expect(health.formats).toEqual(["epub", "pdf"]);

        const library = await getCodiceLibrary(testDir);
        expect(library.books).toBeDefined();
      } finally {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });

    it("health e library funcionam com 200 e formats epub/pdf se codice/txt estiver ilegível (EACCES)", async () => {
      const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-txt-inaccessible-"));
      try {
        await fs.mkdir(path.join(testDir, "codice/epub"), { recursive: true });
        await fs.mkdir(path.join(testDir, "codice/pdf"), { recursive: true });
        await fs.mkdir(path.join(testDir, "codice/txt"), { recursive: true });

        const originalAccess = fs.access;
        const accessSpy = vi.spyOn(fs, "access").mockImplementation(async (pathStr, mode) => {
          if (pathStr.endsWith("codice/txt")) {
            throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
          }
          return originalAccess(pathStr, mode);
        });

        try {
          const health = await getCodiceHealth(testDir);
          expect(health.ok).toBe(true);
          expect(health.formats).toEqual(["epub", "pdf"]);

          const library = await getCodiceLibrary(testDir);
          expect(library.books).toBeDefined();
        } finally {
          accessSpy.mockRestore();
        }
      } finally {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });

    it("health e library falham com 503 se codice/epub ou codice/pdf estiverem ilegíveis ou ausentes", async () => {
      const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "hestia-essential-missing-"));
      try {
        await fs.mkdir(path.join(testDir, "codice/epub"), { recursive: true });

        await expect(getCodiceHealth(testDir)).rejects.toMatchObject({ code: "ECODICELIBRARY" });
        await expect(getCodiceLibrary(testDir)).rejects.toMatchObject({ code: "ECODICELIBRARY" });
      } finally {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
