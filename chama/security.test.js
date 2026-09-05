import { describe, it, expect } from "vitest";
import {
  isLoopbackHost,
  buildAllowedHosts,
  isAllowedHostHeader,
  RateLimiter,
  resolvePresenceCorsOrigins,
  isOriginAllowed,
  applyCodiceCors,
} from "./security.js";

describe("isLoopbackHost", () => {
  it("reconhece os aliases de loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejeita hosts de LAN/externos", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("meuhost.example.com")).toBe(false);
  });
});

describe("buildAllowedHosts / isAllowedHostHeader", () => {
  it("aceita apenas o host:port configurado quando não é loopback", () => {
    const allowed = buildAllowedHosts("192.168.1.10", 4517);
    expect(isAllowedHostHeader("192.168.1.10:4517", allowed)).toBe(true);
    expect(isAllowedHostHeader("localhost:4517", allowed)).toBe(false);
    expect(isAllowedHostHeader("evil.com:4517", allowed)).toBe(false);
  });

  it("aceita aliases de loopback quando o bind é 127.0.0.1", () => {
    const allowed = buildAllowedHosts("127.0.0.1", 4517);
    expect(isAllowedHostHeader("127.0.0.1:4517", allowed)).toBe(true);
    expect(isAllowedHostHeader("localhost:4517", allowed)).toBe(true);
    expect(isAllowedHostHeader("[::1]:4517", allowed)).toBe(true);
    expect(isAllowedHostHeader("evil.com:4517", allowed)).toBe(false);
  });

  it("rejeita Host header rebindado (DNS rebinding) para outro nome", () => {
    const allowed = buildAllowedHosts("127.0.0.1", 4517);
    // Um atacante que rebindou evil.com para 127.0.0.1 ainda envia Host: evil.com:4517
    expect(isAllowedHostHeader("evil.com:4517", allowed)).toBe(false);
  });

  it("rejeita Host ausente ou de porta diferente", () => {
    const allowed = buildAllowedHosts("127.0.0.1", 4517);
    expect(isAllowedHostHeader(undefined, allowed)).toBe(false);
    expect(isAllowedHostHeader("127.0.0.1:9999", allowed)).toBe(false);
  });

  it("rejeita wildcards extras no allowed hosts", () => {
    const allowed = buildAllowedHosts("127.0.0.1", 4517, "extra.ts.net, *.ts.net, *.example.com");
    expect(allowed.has("extra.ts.net")).toBe(true);
    expect(allowed.has("*.ts.net")).toBe(false);
    expect(allowed.has("*.example.com")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("permite até `max` requisições na janela e bloqueia a seguinte", () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 3 });
    const now = 0;
    expect(rl.check("ip1", now).allowed).toBe(true);
    expect(rl.check("ip1", now).allowed).toBe(true);
    expect(rl.check("ip1", now).allowed).toBe(true);
    const fourth = rl.check("ip1", now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("reseta a janela depois de windowMs e isola por chave", () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.check("ip1", 0).allowed).toBe(true);
    expect(rl.check("ip1", 500).allowed).toBe(false);
    expect(rl.check("ip1", 1001).allowed).toBe(true);
    expect(rl.check("ip2", 500).allowed).toBe(true);
  });

  it("sweep remove entradas expiradas", () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 1 });
    rl.check("ip1", 0);
    expect(rl.hits.has("ip1")).toBe(true);
    rl.sweep(2000);
    expect(rl.hits.has("ip1")).toBe(false);
  });
});

describe("resolvePresenceCorsOrigins", () => {
  it("retorna [] quando a env var não está setada (comportamento restritivo por padrão)", () => {
    expect(resolvePresenceCorsOrigins({})).toEqual([]);
  });

  it("faz parse de uma lista separada por vírgula, com espaços", () => {
    expect(
      resolvePresenceCorsOrigins({
        HESTIA_PRESENCE_CORS_ORIGIN: "https://presence.example, https://outra.com",
      }),
    ).toEqual(["https://presence.example", "https://outra.com"]);
  });

  it("aceita '*' literal", () => {
    expect(resolvePresenceCorsOrigins({ HESTIA_PRESENCE_CORS_ORIGIN: "*" })).toEqual(["*"]);
  });
});

describe("isOriginAllowed", () => {
  it("rejeita sempre que a lista está vazia", () => {
    expect(isOriginAllowed("https://presence.example", [])).toBe(false);
  });

  it("aceita origem exata na lista", () => {
    const allowed = ["https://presence.example"];
    expect(isOriginAllowed("https://presence.example", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.com", allowed)).toBe(false);
  });

  it("'*' na lista aceita qualquer origem", () => {
    expect(isOriginAllowed("https://qualquer-coisa.com", ["*"])).toBe(true);
  });

  it("rejeita origin ausente/vazio mesmo com '*' configurado", () => {
    expect(isOriginAllowed(undefined, ["*"])).toBe(false);
    expect(isOriginAllowed("", ["*"])).toBe(false);
  });
});

describe("applyCodiceCors", () => {
  it("permite origem permitida e aplica headers de credentials/PNA", () => {
    const req = {
      headers: {
        origin: "https://codice.example.com",
        "access-control-request-private-network": "true",
      },
    };
    const headers = {};
    const reply = {
      getHeader: (name) => headers[name],
      header: (name, val) => {
        headers[name] = val;
      },
    };

    const allowed = applyCodiceCors(req, reply, "https://codice.example.com, https://outro.com");
    expect(allowed).toBe(true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://codice.example.com");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(headers["Access-Control-Allow-Private-Network"]).toBe("true");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Authorization, Content-Type");
  });

  it("rejeita wildcard '*' no CORS e retorna false", () => {
    const req = {
      headers: {
        origin: "https://codice.example.com",
      },
    };
    const headers = {};
    const reply = {
      getHeader: (name) => headers[name],
      header: (name, val) => {
        headers[name] = val;
      },
    };

    const allowed = applyCodiceCors(req, reply, "*");
    expect(allowed).toBe(false);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("omite credentials quando explicitamente desativado", () => {
    const req = { headers: { origin: "https://codice.example.com" } };
    const headers = {};
    const reply = {
      getHeader: (name) => headers[name],
      header: (name, val) => {
        headers[name] = val;
      },
    };

    const allowed = applyCodiceCors(req, reply, "https://codice.example.com", {
      allowCredentials: false,
    });
    expect(allowed).toBe(true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://codice.example.com");
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("preserva Vary existente ao adicionar Origin", () => {
    const req = { headers: { origin: "https://codice.example.com" } };
    const headers = { Vary: "Accept-Encoding" };
    const reply = {
      getHeader: (name) => headers[name],
      header: (name, value) => {
        headers[name] = value;
      },
    };
    expect(
      applyCodiceCors(req, reply, "https://codice.example.com", { allowCredentials: false }),
    ).toBe(true);
    expect(headers.Vary).toBe("Accept-Encoding, Origin");
  });
});
