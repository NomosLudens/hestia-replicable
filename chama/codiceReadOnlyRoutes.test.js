import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerCodiceReadOnlyRoutes } from "./codiceReadOnlyRoutes.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apps = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("rotas read-only do Códice", () => {
  it("não depende do converter, child_process, LibreOffice ou parser DOCX", () => {
    const source = readFileSync(join(currentDir, "codiceReadOnlyRoutes.js"), "utf8");
    expect(source).toContain('from "./codice.js"');
    for (const forbidden of [
      "codiceConverter",
      "node:child_process",
      "LibreOffice",
      "soffice",
      "addContentTypeParser",
      "/api/codice/import",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("é reutilizada pela Console antes do importador sem duplicar handlers", () => {
    const source = readFileSync(join(currentDir, "codiceRoutes.js"), "utf8");
    expect(source.match(/registerCodiceReadOnlyRoutes\(app, config\)/g)).toHaveLength(1);
    expect(source.indexOf("registerCodiceReadOnlyRoutes(app, config)")).toBeLessThan(
      source.indexOf('app.post("/api/codice/import"'),
    );
    expect(source).toContain('from "./codiceConverter.js"');
  });

  it("registra somente GET e HEAD; outros métodos ficam no notFound do servidor", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerCodiceReadOnlyRoutes(app, { storageRoot: "/inexistente" });
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ ok: false, error: "not_found" });
    });
    await app.ready();

    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await app.inject({ method, url: "/api/codice/import" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ ok: false, error: "not_found" });
    }
  });
});
