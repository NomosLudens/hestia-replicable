import { describe, it, expect } from "vitest";
import { validateStorageSources } from "./storageSources.js";

describe("validateStorageSources", () => {
  const storageRoot = "/tmp/hestia-test/KALINE";
  const valid = (overrides = {}) => ({
    id: " filmes-hd ",
    label: " Filmes do HD ",
    path: " /mnt/hd/Filmes ",
    category: " midia/videos ",
    mode: "external-readonly",
    extra: "ignored",
    ...overrides,
  });

  it("carrega fonte válida, trima strings e descarta campos extras", () => {
    expect(validateStorageSources([valid()], { storageRoot })).toEqual([
      {
        id: "filmes-hd",
        label: "Filmes do HD",
        path: "/mnt/hd/Filmes",
        category: "midia/videos",
        mode: "external-readonly",
      },
    ]);
  });

  it("ignora entradas inválidas sem inventar dados", () => {
    const invalid = [
      null,
      [],
      valid({ path: "relativo" }),
      valid({ path: " " }),
      valid({ id: " " }),
      valid({ label: " " }),
      valid({ category: " " }),
      valid({ mode: "copy" }),
      valid({ path: "/" }),
      valid({ path: `${storageRoot}/entrada` }),
      valid({ path: "/mnt/KALINE/Filmes" }),
      valid({ path: "/tmp/hestia-test" }),
    ];
    expect(validateStorageSources(invalid, { storageRoot })).toEqual([]);
  });

  it("mantém somente a primeira ocorrência para id ou path duplicados", () => {
    const result = validateStorageSources(
      [
        valid({ id: "a", path: "/mnt/a", label: "A" }),
        valid({ id: "a", path: "/mnt/b", label: "B" }),
        valid({ id: "c", path: "/mnt/a/../a", label: "C" }),
        valid({ id: "d", path: "/mnt/d", label: "D" }),
      ],
      { storageRoot },
    );
    expect(result.map((source) => source.id)).toEqual(["a", "d"]);
    expect(result.map((source) => source.path)).toEqual(["/mnt/a", "/mnt/d"]);
  });

  it("retorna [] quando storageSources está ausente ou não é array", () => {
    expect(validateStorageSources(undefined, { storageRoot })).toEqual([]);
    expect(validateStorageSources({}, { storageRoot })).toEqual([]);
  });
});
