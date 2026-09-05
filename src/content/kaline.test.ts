import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nav } from "./kaline";

describe("navegação principal", () => {
  it("oculta o Códice legado sem remover sua rota de compatibilidade", () => {
    const navPaths = nav.map((item) => String(item.to));
    expect(navPaths).not.toContain("/codice");
    expect(nav.some((item) => item.label === "Códice")).toBe(false);
    expect(navPaths).not.toContain("/organizador");
    expect(navPaths).not.toContain("/assistente");
    expect(existsSync(join(process.cwd(), "src/routes/_station.assistente.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/routes/_station.codice.tsx"))).toBe(true);
  });
});
