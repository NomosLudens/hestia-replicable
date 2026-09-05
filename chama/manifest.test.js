import { describe, it, expect } from "vitest";
import { getManifest } from "./manifest.js";

describe("getManifest", () => {
  it("retorna manifesto estático com estrutura correta", () => {
    const manifest = getManifest();
    expect(manifest.station).toBeDefined();
    expect(manifest.station.name).toBe("Héstia Console");
    expect(manifest.station.tagline).toBeDefined();
    expect(Array.isArray(manifest.station.components)).toBe(true);
  });

  it("inclui os três componentes (Héstia, Console, Chama Local)", () => {
    const manifest = getManifest();
    const names = manifest.station.components.map((c) => c.name);
    expect(names).toContain("Héstia");
    expect(names).toContain("Héstia Console");
    expect(names).toContain("Chama Local");
  });

  it("define capabilities.readonly como true (leitura por padrão)", () => {
    const manifest = getManifest();
    expect(manifest.capabilities.readonly).toBe(true);
    expect(manifest.capabilities.readonlyByDefault).toBe(true);
    expect(manifest.capabilities.controlledWrites).toBe(true);
    expect(manifest.capabilities.writeCapabilities).toEqual([]);
  });

  it("sempre retorna o mesmo objeto (sem mutação)", () => {
    const m1 = getManifest();
    const m2 = getManifest();
    expect(m1.station.name).toBe(m2.station.name);
  });
});
