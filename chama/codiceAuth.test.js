import { describe, expect, it, vi } from "vitest";

import { authenticateCodiceRequest, extractBearer } from "./codiceAuth.js";

const allowedId = "11111111-1111-4111-8111-111111111111";
const deniedId = "22222222-2222-4222-8222-222222222222";
const publishableKey = "sb_publishable_synthetic_test_key";

function authenticate(fetchImpl, authorization = "Bearer user-token") {
  return authenticateCodiceRequest({
    authorization,
    supabaseUrl: "https://project.example",
    publishableKey,
    allowedUserIds: new Set([allowedId]),
    fetchImpl,
  });
}

describe("Kódice Supabase Auth", () => {
  it.each([
    undefined,
    "",
    "Basic token",
    "Bearer",
    "Bearer    ",
    "Bearer one two",
    "Bearer one,Bearertwo",
    "Bearer one, Bearer two",
    ["Bearer one"],
  ])("rejeita Bearer ausente ou ambíguo: %j", (value) => expect(extractBearer(value)).toBeNull());

  it("consulta o Auth server com a publishable key e o Bearer recebidos", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: allowedId }));
    await expect(authenticate(fetchImpl)).resolves.toEqual({ ok: true, userId: allowedId });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://project.example/auth/v1/user");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.headers).toEqual({ apikey: publishableKey, Authorization: "Bearer user-token" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403])("classifica rejeição explícita %i como token inválido", async (status) => {
    await expect(authenticate(async () => new Response(null, { status }))).resolves.toEqual({
      ok: false,
      status: 401,
      error: "authentication_failed",
    });
  });

  it("separa usuário autenticado fora da allowlist", async () => {
    await expect(authenticate(async () => Response.json({ id: deniedId }))).resolves.toEqual({
      ok: false,
      status: 403,
      error: "authorization_failed",
    });
  });

  it.each([302, 400, 404, 429, 500, 503])(
    "classifica status inesperado %i como indisponibilidade",
    async (status) => {
      await expect(authenticate(async () => new Response(null, { status }))).resolves.toEqual({
        ok: false,
        status: 503,
        error: "authentication_unavailable",
      });
    },
  );

  it.each([
    ["rede", async () => Promise.reject(new Error("network secret"))],
    ["timeout", async () => Promise.reject(new DOMException("timeout secret", "TimeoutError"))],
    ["redirect", async () => Promise.reject(new TypeError("redirect"))],
    ["JSON inválido", async () => new Response("not-json")],
    ["id ausente", async () => Response.json({ email: "private@example.test" })],
    ["id inválido", async () => Response.json({ id: "not-a-uuid" })],
  ])("não vaza detalhe quando %s falha", async (_label, fetchImpl) => {
    const result = await authenticate(fetchImpl);
    expect(result).toEqual({ ok: false, status: 503, error: "authentication_unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private@example.test");
  });

  it("não registra token, chave ou erro remoto", async () => {
    const spies = ["log", "warn", "error"].map((method) => vi.spyOn(console, method));
    const result = await authenticate(async () =>
      Promise.reject(new Error(`remote ${publishableKey} user-token`)),
    );
    expect(result.error).toBe("authentication_unavailable");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
