import { URL } from "node:url";

function isLoopbackUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

export function parseCloudflaredMetrics(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { connected: false, haConnections: 0, protocol: "unknown", edgeColo: null };
  }

  let haConnections = 0;
  let connected = false;
  let protocol = "unknown";
  let edgeColo = null;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;

    if (trimmed.startsWith("cloudflared_tunnel_ha_connections")) {
      const match = /^cloudflared_tunnel_ha_connections(?:\{[^}]*\})?\s+(\d+)/.exec(trimmed);
      if (match) haConnections = parseInt(match[1], 10);
    } else if (trimmed.startsWith("cloudflared_tunnel_user_connections")) {
      const match = /^cloudflared_tunnel_user_connections(?:\{[^}]*\})?\s+(\d+)/.exec(trimmed);
      if (match && haConnections === 0) haConnections = parseInt(match[1], 10);
    } else if (trimmed.startsWith("cloudflared_tunnel_connected")) {
      const match = /^cloudflared_tunnel_connected(?:\{[^}]*\})?\s+(\d+)/.exec(trimmed);
      if (match) connected = parseInt(match[1], 10) > 0;
    }

    if (trimmed.includes('protocol="') && protocol === "unknown") {
      const match = /protocol="([^"]+)"/.exec(trimmed);
      if (match) protocol = match[1];
    }
    if (trimmed.includes('user_colo="') && !edgeColo) {
      const match = /user_colo="([^"]+)"/.exec(trimmed);
      if (match) edgeColo = match[1];
    }
  }

  if (haConnections > 0) connected = true;

  return { connected, haConnections, protocol, edgeColo };
}

export async function checkPublicRoute(urlStr, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    return {
      hostname: null,
      status: "not_configured",
      httpStatus: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    };
  }

  let hostname = null;
  try {
    const parsedUrl = new URL(urlStr);
    hostname = parsedUrl.hostname;
  } catch {
    return {
      hostname: null,
      status: "not_configured",
      httpStatus: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    };
  }

  const start = performance.now();
  try {
    const res = await fetchImpl(urlStr, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(options.timeoutMs || 5000),
    });

    const latencyMs = Math.max(0, Math.round(performance.now() - start));
    const isOk = res.status >= 200 && res.status < 300;

    return {
      hostname,
      status: isOk ? "ok" : "fail",
      httpStatus: res.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    const latencyMs = Math.max(0, Math.round(performance.now() - start));
    return {
      hostname,
      status: "unavailable",
      httpStatus: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function getStationTunnelStatus(options = {}) {
  const env = options.env || process.env;
  const stationId = options.stationId || env.HESTIA_STATION_ID || "tvbox";

  const isTunnelStation =
    stationId === "tvbox" ||
    stationId === "max" ||
    Boolean(options.tunnelName) ||
    Boolean(env.HESTIA_STATION_TUNNEL_NAME) ||
    Boolean(options.metricsUrl) ||
    Boolean(env.HESTIA_STATION_TUNNEL_METRICS_URL);

  if (!isTunnelStation) {
    const now = new Date().toISOString();
    return {
      ok: true,
      schemaVersion: 1,
      status: "unsupported",
      checkedAt: now,
      tunnel: {
        name: "",
        connected: false,
        haConnections: 0,
        protocol: "unknown",
        edgeColo: null,
        connectorStatus: "unsupported",
      },
      publicRoute: {
        hostname: null,
        status: "not_configured",
        httpStatus: null,
        latencyMs: null,
        checkedAt: now,
      },
    };
  }

  const defaultTunnelName =
    stationId === "tvbox"
      ? "hestia-kaline-box"
      : stationId === "max"
        ? "kallistis-max"
        : "cloudflared";

  const metricsUrl = options.metricsUrl || env.HESTIA_STATION_TUNNEL_METRICS_URL || "";
  const publicRouteUrl =
    options.publicRouteUrl ||
    env.HESTIA_STATION_PUBLIC_HEALTH_URL ||
    env.HESTIA_PUBLIC_HEALTH_URL ||
    "";

  const tunnelName =
    options.tunnelName ||
    env.HESTIA_STATION_TUNNEL_NAME ||
    env.HESTIA_TUNNEL_NAME ||
    defaultTunnelName;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = new Date().toISOString();

  let connectorStatus = "not_configured";
  let connectorInfo = { connected: false, haConnections: 0, protocol: "unknown", edgeColo: null };

  if (metricsUrl && isLoopbackUrl(metricsUrl)) {
    try {
      const res = await fetchImpl(metricsUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const text = await res.text();
        connectorInfo = parseCloudflaredMetrics(text);
        if (connectorInfo.haConnections === 0) {
          connectorStatus = "down";
        } else if (connectorInfo.haConnections < 4) {
          connectorStatus = "degraded";
        } else {
          connectorStatus = "healthy";
        }
      } else {
        connectorStatus = "unavailable";
      }
    } catch {
      connectorStatus = "unavailable";
    }
  } else if (metricsUrl) {
    connectorStatus = "not_configured";
  }

  const publicRoute = await checkPublicRoute(publicRouteUrl, { fetchImpl, timeoutMs: 5000 });

  let status = "ok";
  if (connectorStatus === "not_configured" && publicRoute.status === "not_configured") {
    status = "not_configured";
  } else if (
    connectorStatus === "down" ||
    (connectorStatus !== "not_configured" && !connectorInfo.connected)
  ) {
    status = "down";
  } else if (
    connectorStatus === "unavailable" ||
    connectorStatus === "degraded" ||
    publicRoute.status === "fail" ||
    publicRoute.status === "unavailable" ||
    publicRoute.status === "degraded"
  ) {
    status = "degraded";
  } else if (
    connectorStatus === "healthy" &&
    (publicRoute.status === "ok" || publicRoute.status === "not_configured")
  ) {
    status = "ok";
  } else if (connectorStatus === "not_configured" && publicRoute.status === "ok") {
    status = "ok";
  }

  return {
    ok: true,
    schemaVersion: 1,
    status,
    checkedAt: now,
    tunnel: {
      name: tunnelName,
      connected: connectorInfo.connected,
      haConnections: connectorInfo.haConnections,
      protocol: connectorInfo.protocol,
      edgeColo: connectorInfo.edgeColo,
      connectorStatus,
    },
    publicRoute,
  };
}
