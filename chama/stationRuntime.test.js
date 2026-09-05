import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function imports(file, seen = new Set()) {
  const absolute = resolve(root, file);
  if (seen.has(absolute)) return seen;
  seen.add(absolute);
  const source = readFileSync(absolute, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith(".")) continue;
    const child = resolve(dirname(absolute), match[1]);
    imports(child.endsWith(".js") ? child : `${child}.js`, seen);
  }
  return seen;
}

describe("runtime mínimo da Station", () => {
  it("declara somente Fastify como dependência externa", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "packaging/station-runtime/package.json")));
    expect(pkg.dependencies).toEqual({ fastify: "5.9.0" });
  });

  it("empacota todo módulo chama importado transitivamente pela Station", () => {
    const installer = readFileSync(resolve(root, "scripts/install-station-agent.sh"), "utf8");
    const manifest = installer.match(/for file in ([^;]+); do/);
    expect(manifest).not.toBeNull();

    const packaged = new Set(manifest[1].trim().split(/\s+/));
    const chamaPrefix = `chama${sep}`;
    const required = [...imports("station.js")]
      .filter((file) => relative(root, file).startsWith(chamaPrefix))
      .map((file) => basename(file));

    const missing = [...new Set(required)].filter((file) => !packaged.has(file)).sort();
    expect(missing).toEqual([]);
  });

  it("não importa frontend, conversor nem escrita no fluxo do Códice", () => {
    const files = [...imports("station.js")];
    const joined = files.join("\n");
    for (const forbidden of [
      "/src/",
      "dist/client",
      "codiceConverter",
      "react",
      "vite",
      "tailwind",
      "recharts",
      "@tanstack/",
    ]) {
      expect(joined).not.toContain(forbidden);
    }
    const codiceSource =
      readFileSync(resolve(root, "chama/codice.js"), "utf8") +
      readFileSync(resolve(root, "chama/codiceReadOnlyRoutes.js"), "utf8");
    expect(codiceSource).not.toContain("node:child_process");
    expect(codiceSource).not.toContain("codiceConverter");
  });
});
