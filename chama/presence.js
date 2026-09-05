// Chama Local — wrappers para rotas de Presence.
// presenceRoute captura erros, loga o real, mas devolve mensagem genérica e segura.
import { log } from "./logs.js";

const SCHEMA_VERSION = "1.0.0";

export function presenceEnvelope(data) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...data,
  };
}

export function presenceErrorBody(code, message) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: false,
    error: message || "Erro na Chama Local",
    code,
  };
}

export function presenceRoute(handler) {
  return async (req, reply) => {
    try {
      const data = await handler(req);
      reply.send(presenceEnvelope(data));
    } catch (err) {
      const code = err.code || err.name || "EUNKNOWN";
      const detail = err.message || "erro sem mensagem";
      log("error", `Presence route error: ${code}: ${detail}`);

      // Nunca expõe a mensagem de erro original — pode ter dados sensíveis
      const safeMessage = "Erro ao processar solicitação";
      reply.code(500).send(presenceErrorBody(code, safeMessage));
    }
  };
}
