import { describe, it, expect } from "vitest";
import { getServiceBindings, getPresenceServiceBindings } from "./serviceBindings.js";

describe("getServiceBindings", () => {
  it("retorna apenas serviços padrão da TV Box", () => {
    const bindings = getServiceBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings.map((b) => b.id)).toEqual(["tailscale"]);
  });

  it("usa serviceName da allowlist da TV Box", () => {
    const bindings = getServiceBindings();
    const byId = Object.fromEntries(bindings.map((b) => [b.id, b.serviceName]));
    expect(byId).toEqual({ tailscale: "tailscaled" });
  });

  it("nunca inclui campos de comando/escrita", () => {
    const bindings = getServiceBindings();
    const forbiddenFields = ["start", "stop", "restart", "configure", "write", "delete"];
    for (const binding of bindings) {
      for (const field of forbiddenFields) {
        expect(binding).not.toHaveProperty(field);
      }
    }
  });
});

describe("getPresenceServiceBindings", () => {
  it("retorna só id/label/role, sem relatedStorage nem serviceName", () => {
    const bindings = getPresenceServiceBindings();
    expect(bindings).toHaveLength(1);
    for (const binding of bindings) {
      expect(Object.keys(binding).sort()).toEqual(["id", "label", "role"]);
    }
  });
});
