import { describe, expect, it } from "vitest";
import { parseNodeVersion, supportsHestiaNode } from "../scripts/require-node.mjs";

describe("Node mínimo real", () => {
  it.each([
    ["22.11.9", false],
    ["22.12.9", false],
    ["22.14.0", true],
    ["22.13.0", true],
    ["24.0.0", true],
    ["inválida", false],
  ])("compara %s", (version, expected) => {
    expect(supportsHestiaNode(version)).toBe(expected);
  });

  it("rejeita componentes ausentes", () => expect(parseNodeVersion("22.13")).toBeNull());
});
