import {
  getCodiceHealth,
  getCodiceLibrary,
  resolveCodiceBook,
  getBookHeaders,
  isCodiceLibraryUnavailableError,
  openVerifiedCodiceBook,
} from "./codice.js";

export function createCodiceHealthHandler(storageRoot) {
  return async function codiceHealthHandler(_req, reply) {
    try {
      return await getCodiceHealth(storageRoot);
    } catch (err) {
      if (isCodiceLibraryUnavailableError(err)) {
        reply.code(503).send({
          ok: false,
          error: "Biblioteca do Códice indisponível",
          code: "CODICE_LIBRARY_UNAVAILABLE",
          at: new Date().toISOString(),
        });
        return;
      }
      reply.code(500).send({
        ok: false,
        error: "Erro interno do servidor",
        code: "INTERNAL_SERVER_ERROR",
        at: new Date().toISOString(),
      });
    }
  };
}

export function registerCodiceReadOnlyRoutes(app, config) {
  app.get(
    "/api/codice/health",
    config.healthHandler || createCodiceHealthHandler(config.storageRoot),
  );

  app.get("/api/codice/library", async (_req, reply) => {
    try {
      return await getCodiceLibrary(config.storageRoot);
    } catch (err) {
      if (isCodiceLibraryUnavailableError(err)) {
        reply.code(503).send({
          ok: false,
          error: "Biblioteca do Códice indisponível",
          code: "CODICE_LIBRARY_UNAVAILABLE",
          at: new Date().toISOString(),
        });
        return;
      }
      reply.code(500).send({
        ok: false,
        error: "Erro ao varrer a biblioteca",
        code: "INTERNAL_SERVER_ERROR",
        at: new Date().toISOString(),
      });
    }
  });

  app.head("/api/codice/books/:bookId", async (req, reply) => {
    try {
      const resolved = await resolveCodiceBook(config.storageRoot, req.params.bookId);
      if (!resolved) {
        reply.code(404).send({
          ok: false,
          error: "Livro não encontrado",
          code: "CODICE_BOOK_NOT_FOUND",
          at: new Date().toISOString(),
        });
        return;
      }

      let fileHandle;
      let stat;
      try {
        const opened = await openVerifiedCodiceBook(resolved);
        fileHandle = opened.fileHandle;
        stat = opened.stat;
      } catch {
        reply.code(503).send({
          ok: false,
          error: "Não foi possível transmitir o livro.",
          code: "CODICE_BOOK_UNAVAILABLE",
          at: new Date().toISOString(),
        });
        return;
      }

      try {
        reply.headers(getBookHeaders({ ...resolved, stat }));
        reply.code(200).send();
      } finally {
        await fileHandle.close().catch(() => {});
      }
    } catch {
      reply.code(500).send({
        ok: false,
        error: "Erro ao resolver livro",
        code: "INTERNAL_SERVER_ERROR",
        at: new Date().toISOString(),
      });
    }
  });

  app.get("/api/codice/books/:bookId", async (req, reply) => {
    let fileHandle = null;
    try {
      const resolved = await resolveCodiceBook(config.storageRoot, req.params.bookId);
      if (!resolved) {
        reply.code(404).send({
          ok: false,
          error: "Livro não encontrado",
          code: "CODICE_BOOK_NOT_FOUND",
          at: new Date().toISOString(),
        });
        return;
      }

      let stat;
      try {
        const opened = await openVerifiedCodiceBook(resolved);
        fileHandle = opened.fileHandle;
        stat = opened.stat;
      } catch {
        reply.code(503).send({
          ok: false,
          error: "Não foi possível transmitir o livro.",
          code: "CODICE_BOOK_UNAVAILABLE",
          at: new Date().toISOString(),
        });
        return;
      }

      reply.headers(getBookHeaders({ ...resolved, stat }));
      const stream = fileHandle.createReadStream();

      stream.on("error", () => {
        if (!reply.raw.headersSent) {
          reply.code(503).send({
            ok: false,
            error: "Não foi possível transmitir o livro.",
            code: "CODICE_BOOK_UNAVAILABLE",
            at: new Date().toISOString(),
          });
        } else {
          reply.raw.destroy();
        }
        fileHandle?.close().catch(() => {});
      });

      reply.raw.on("close", () => {
        fileHandle?.close().catch(() => {});
      });

      return reply.send(stream);
    } catch {
      if (fileHandle) await fileHandle.close().catch(() => {});
      reply.code(503).send({
        ok: false,
        error: "Não foi possível transmitir o livro.",
        code: "CODICE_BOOK_UNAVAILABLE",
        at: new Date().toISOString(),
      });
    }
  });
}
