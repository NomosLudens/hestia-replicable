import { convertDocxToEpub } from "./codiceConverter.js";
import { registerCodiceReadOnlyRoutes } from "./codiceReadOnlyRoutes.js";

export function registerCodiceRoutes(app, config) {
  // Parser para receber arquivos binários (.docx)
  app.addContentTypeParser(
    [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    { parseAs: "buffer" },
    (req, body, done) => {
      done(null, body);
    },
  );

  registerCodiceReadOnlyRoutes(app, config);

  app.post("/api/codice/import", async (req, reply) => {
    const fileName = req.query.name || "documento.docx";
    if (!fileName.toLowerCase().endsWith(".docx")) {
      reply.code(400).send({
        ok: false,
        error: "Extensão inválida",
        code: "EINVALIDEXTENSION",
        detail: "Apenas arquivos .docx são aceitos para conversão.",
        at: new Date().toISOString(),
      });
      return;
    }

    if (!req.body || req.body.length === 0) {
      reply.code(400).send({
        ok: false,
        error: "Corpo vazio",
        code: "EEMPTYBODY",
        detail: "Nenhum arquivo enviado no corpo da requisição.",
        at: new Date().toISOString(),
      });
      return;
    }

    try {
      const result = await convertDocxToEpub(req.body, fileName, config.storageRoot);
      return result;
    } catch (err) {
      reply.code(500).send({
        ok: false,
        error: "Falha na conversão do arquivo",
        code: "ECONVERSIONFAILED",
        detail: err.message,
        at: new Date().toISOString(),
      });
    }
  });

  // --- Wildcard router para fechar a API do Códice contra outros métodos e caminhos ---
  app.all("/api/codice/*", async (req, reply) => {
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }

    const urlPath = req.routerPath || req.url;
    const pathname = urlPath.split("?")[0];

    const isHealth = pathname === "/api/codice/health";
    const isLibrary = pathname === "/api/codice/library";
    const isImport = pathname === "/api/codice/import";
    const parts = pathname.split("/").filter(Boolean);
    const isBook =
      parts.length === 4 && parts[0] === "api" && parts[1] === "codice" && parts[2] === "books";

    if (isHealth || isLibrary || isBook || isImport) {
      reply.code(405).send({
        ok: false,
        error: "Método não permitido",
        code: "METHOD_NOT_ALLOWED",
        at: new Date().toISOString(),
      });
      return;
    }

    reply.code(404).send({
      ok: false,
      error: "Recurso não encontrado",
      code: "CODICE_BOOK_NOT_FOUND",
      at: new Date().toISOString(),
    });
  });
}
