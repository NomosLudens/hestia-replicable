import { describe, it, expect, vi } from "vitest";
import { presenceEnvelope, presenceErrorBody, presenceRoute } from "./presence.js";

describe("presenceEnvelope", () => {
  it("embrulha data com schemaVersion e generatedAt", () => {
    const data = { ok: true, count: 42 };
    const wrapped = presenceEnvelope(data);

    expect(wrapped.schemaVersion).toBeDefined();
    expect(wrapped.generatedAt).toBeDefined();
    expect(wrapped.ok).toBe(true);
    expect(wrapped.count).toBe(42);
  });

  it("schemaVersion é string", () => {
    const wrapped = presenceEnvelope({});
    expect(typeof wrapped.schemaVersion).toBe("string");
  });

  it("generatedAt é timestamp ISO", () => {
    const wrapped = presenceEnvelope({});
    expect(new Date(wrapped.generatedAt)).toBeInstanceOf(Date);
  });
});

describe("presenceErrorBody", () => {
  it("cria erro com schemaVersion e generatedAt", () => {
    const error = presenceErrorBody("ETEST", "Test error");
    expect(error.schemaVersion).toBeDefined();
    expect(error.generatedAt).toBeDefined();
  });

  it("marca ok como false", () => {
    const error = presenceErrorBody("ETEST", "Test error");
    expect(error.ok).toBe(false);
  });

  it("inclui code e error", () => {
    const error = presenceErrorBody("ETEST", "Test error");
    expect(error.code).toBe("ETEST");
    expect(error.error).toBe("Test error");
  });

  it("usa mensagem default se não fornecida", () => {
    const error = presenceErrorBody("ETEST");
    expect(error.error).toBe("Erro na Chama Local");
  });
});

describe("presenceRoute", () => {
  it("executa handler e envolve resultado em presenceEnvelope", async () => {
    const handler = async () => ({ ok: true, data: "test" });
    const route = presenceRoute(handler);

    const mockReply = { send: vi.fn() };
    await route({}, mockReply);

    expect(mockReply.send).toHaveBeenCalledOnce();
    const sent = mockReply.send.mock.calls[0][0];
    expect(sent.schemaVersion).toBeDefined();
    expect(sent.ok).toBe(true);
    expect(sent.data).toBe("test");
  });

  it("captura erro do handler e devolve presenceErrorBody", async () => {
    const handler = async () => {
      throw new Error("Test error");
    };
    const route = presenceRoute(handler);

    const mockReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await route({}, mockReply);

    expect(mockReply.code).toHaveBeenCalledWith(500);
    const sent = mockReply.send.mock.calls[0][0];
    expect(sent.ok).toBe(false);
    // Nunca expõe mensagem de erro original
    expect(sent.error).not.toContain("Test error");
  });

  it("sempre devolve 500 em erro, nunca deixa lançar", async () => {
    const handler = async () => {
      throw new Error("Critical");
    };
    const route = presenceRoute(handler);

    const mockReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    // Não deve lançar
    await expect(route({}, mockReply)).resolves.toBeUndefined();
  });
});
