const AUTH_TIMEOUT_MS = 4000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidCodiceUserId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function extractBearer(authorization) {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([^\s,]+)$/.exec(authorization);
  return match?.[1] || null;
}

export async function authenticateCodiceRequest({
  authorization,
  supabaseUrl,
  publishableKey,
  allowedUserIds,
  fetchImpl = globalThis.fetch,
}) {
  const bearer = extractBearer(authorization);
  if (!bearer) return { ok: false, status: 401, error: "authentication_required" };

  let response;
  try {
    response = await fetchImpl(new URL("/auth/v1/user", supabaseUrl), {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${bearer}`,
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, error: "authentication_unavailable" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 401, error: "authentication_failed" };
  }
  if (response.status !== 200) {
    return { ok: false, status: 503, error: "authentication_unavailable" };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 503, error: "authentication_unavailable" };
  }
  if (!isValidCodiceUserId(body?.id)) {
    return { ok: false, status: 503, error: "authentication_unavailable" };
  }
  if (!allowedUserIds.has(body.id)) {
    return { ok: false, status: 403, error: "authorization_failed" };
  }
  return { ok: true, userId: body.id };
}
