import { describe, it, expect } from "vitest";
import { getStorageModel } from "./storageModel.js";

describe("getStorageModel", () => {
  it("retorna root /KALINE", () => {
    expect(getStorageModel().root).toBe("/KALINE");
  });

  it("cada pasta tem os campos canônicos exigidos", () => {
    const { folders } = getStorageModel();
    expect(folders.length).toBeGreaterThan(0);
    for (const f of folders) {
      expect(typeof f.id).toBe("string");
      expect(typeof f.label).toBe("string");
      expect(typeof f.relativePath).toBe("string");
      expect(typeof f.absolutePath).toBe("string");
      expect(typeof f.category).toBe("string");
      expect(typeof f.purpose).toBe("string");
      expect(typeof f.required).toBe("boolean");
      expect(Array.isArray(f.serviceHints)).toBe(true);
    }
  });

  it("absolutePath é sempre root + relativePath", () => {
    const { root, folders } = getStorageModel();
    for (const f of folders) {
      expect(f.absolutePath).toBe(`${root}/${f.relativePath}`);
    }
  });

  it("ids são únicos", () => {
    const { folders } = getStorageModel();
    const ids = folders.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("inclui as pastas essenciais do fluxo (entrada, midia/videos, codice/pdf)", () => {
    const { folders } = getStorageModel();
    const byRelativePath = Object.fromEntries(folders.map((f) => [f.relativePath, f]));
    expect(byRelativePath["entrada"]).toBeDefined();
    expect(byRelativePath["entrada"].serviceHints).toContain("samba");
    expect(byRelativePath["midia/videos"]).toBeDefined();
    expect(byRelativePath["midia/videos"].serviceHints).toEqual(
      expect.arrayContaining(["jellyfin", "samba"]),
    );
    expect(byRelativePath["codice/pdf"]).toBeDefined();
    for (const rel of [
      "entrada/uploads",
      "entrada/dispositivos",
      "entrada/manual",
      "entrada/revisar",
      "ash/planos",
      "ash/runs",
      "ash/quarentena",
      "ash/ignorados",
      "documentos/textos",
      "documentos/planilhas",
      "documentos/apresentacoes",
    ])
      expect(byRelativePath[rel]).toBeDefined();
  });

  it("sempre retorna o mesmo conteúdo (sem mutação entre chamadas)", () => {
    const m1 = getStorageModel();
    const m2 = getStorageModel();
    expect(m1.folders.length).toBe(m2.folders.length);
    expect(m1.folders[0].id).toBe(m2.folders[0].id);
  });
});
