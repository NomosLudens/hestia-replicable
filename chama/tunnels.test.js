import { describe, expect, it } from "vitest";
import { checkPublicRoute, getStationTunnelStatus, parseCloudflaredMetrics } from "./tunnels.js";

const METRICS_FIXTURE_HEALTHY = `
# HELP cloudflared_tunnel_ha_connections The number of active HA connections
# TYPE cloudflared_tunnel_ha_connections gauge
cloudflared_tunnel_ha_connections{user_colo="GRU"} 4
# HELP cloudflared_tunnel_user_connections The number of active user connections
# TYPE cloudflared_tunnel_user_connections gauge
cloudflared_tunnel_user_connections{conn_type="quic",protocol="quic",user_colo="GRU"} 4
`;

const METRICS_FIXTURE_DEGRADED_1 = `
cloudflared_tunnel_ha_connections 1
cloudflared_tunnel_user_connections{protocol="quic"} 1
`;

const METRICS_FIXTURE_DEGRADED_3 = `
cloudflared_tunnel_ha_connections 3
cloudflared_tunnel_user_connections{protocol="quic"} 3
`;

const METRICS_FIXTURE_ZERO = `
cloudflared_tunnel_ha_connections 0
cloudflared_tunnel_connected 0
`;

describe("parseCloudflaredMetrics", () => {
  it("extrai conexões HA, protocolo e colo de métricas válidas", () => {
    const res = parseCloudflaredMetrics(METRICS_FIXTURE_HEALTHY);
    expect(res.haConnections).toBe(4);
    expect(res.connected).toBe(true);
    expect(res.protocol).toBe("quic");
    expect(res.edgeColo).toBe("GRU");
  });

  it("identifica degradação em conexões parciais", () => {
    const res = parseCloudflaredMetrics(METRICS_FIXTURE_DEGRADED_3);
    expect(res.haConnections).toBe(3);
    expect(res.connected).toBe(true);
    expect(res.protocol).toBe("quic");
  });

  it("retorna estado desconectado para texto vazio ou sem métricas", () => {
    const res = parseCloudflaredMetrics("");
    expect(res.connected).toBe(false);
    expect(res.haConnections).toBe(0);
  });
});

describe("checkPublicRoute — Regras Estritas 2xx", () => {
  it("retorna not_configured para URL vazia ou inválida", async () => {
    const res = await checkPublicRoute("");
    expect(res.status).toBe("not_configured");
    expect(res.hostname).toBeNull();
  });

  it("200 -> pass (ok)", async () => {
    const fakeFetch = async () => new Response("OK", { status: 200 });
    const res = await checkPublicRoute("https://hestia.nomosludens.ia.br/api/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("ok");
    expect(res.httpStatus).toBe(200);
  });

  it("204 -> pass (ok)", async () => {
    const fakeFetch = async () => new Response(null, { status: 204 });
    const res = await checkPublicRoute("https://hestia.nomosludens.ia.br/api/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("ok");
    expect(res.httpStatus).toBe(204);
  });

  it("302 -> fail", async () => {
    const fakeFetch = async () => new Response("Redirect", { status: 302 });
    const res = await checkPublicRoute("https://hestia.nomosludens.ia.br/api/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("fail");
    expect(res.httpStatus).toBe(302);
  });

  it("404 -> fail", async () => {
    const fakeFetch = async () => new Response("Not Found", { status: 404 });
    const res = await checkPublicRoute("https://hestia.nomosludens.ia.br/api/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("fail");
    expect(res.httpStatus).toBe(404);
  });

  it("500 -> fail", async () => {
    const fakeFetch = async () => new Response("Server Error", { status: 500 });
    const res = await checkPublicRoute("https://hestia.nomosludens.ia.br/api/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("fail");
    expect(res.httpStatus).toBe(500);
  });

  it("timeout / net error -> unavailable", async () => {
    const fakeFetch = async () => {
      throw new Error("Timeout");
    };
    const res = await checkPublicRoute("https://cauldron.nomosludens.ia.br/health", {
      fetchImpl: fakeFetch,
    });
    expect(res.status).toBe("unavailable");
  });
});

describe("getStationTunnelStatus — Requisitos de Conector e Tunnel", () => {
  it("sem metrics URL -> connectorStatus not_configured", async () => {
    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      env: {},
    });
    expect(res.tunnel.connectorStatus).toBe("not_configured");
  });

  it("metrics network error -> connectorStatus unavailable", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) throw new Error("Metrics unreachable");
      return new Response("OK", { status: 200 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.connectorStatus).toBe("unavailable");
    expect(res.status).toBe("down");
  });

  it("0 HA + public pass -> status down (connectorStatus down)", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) return new Response(METRICS_FIXTURE_ZERO, { status: 200 });
      return new Response("OK", { status: 200 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      publicRouteUrl: "https://hestia.nomosludens.ia.br/api/health",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.haConnections).toBe(0);
    expect(res.tunnel.connectorStatus).toBe("down");
    expect(res.status).toBe("down");
  });

  it("0 HA + public fail -> status down", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) return new Response(METRICS_FIXTURE_ZERO, { status: 200 });
      return new Response("Error", { status: 500 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      publicRouteUrl: "https://hestia.nomosludens.ia.br/api/health",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.connectorStatus).toBe("down");
    expect(res.status).toBe("down");
  });

  it("1 HA -> connectorStatus degraded e overall degraded", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) return new Response(METRICS_FIXTURE_DEGRADED_1, { status: 200 });
      return new Response("OK", { status: 200 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      publicRouteUrl: "https://hestia.nomosludens.ia.br/api/health",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.connectorStatus).toBe("degraded");
    expect(res.status).toBe("degraded");
  });

  it("3 HA -> connectorStatus degraded e overall degraded", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) return new Response(METRICS_FIXTURE_DEGRADED_3, { status: 200 });
      return new Response("OK", { status: 200 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      publicRouteUrl: "https://hestia.nomosludens.ia.br/api/health",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.connectorStatus).toBe("degraded");
    expect(res.status).toBe("degraded");
  });

  it("4 HA -> connectorStatus healthy e overall ok", async () => {
    const fakeFetch = async (url) => {
      if (url.includes("20242")) return new Response(METRICS_FIXTURE_HEALTHY, { status: 200 });
      return new Response("OK", { status: 200 });
    };

    const res = await getStationTunnelStatus({
      stationId: "tvbox",
      metricsUrl: "http://127.0.0.1:20242/metrics",
      publicRouteUrl: "https://hestia.nomosludens.ia.br/api/health",
      fetchImpl: fakeFetch,
    });
    expect(res.tunnel.connectorStatus).toBe("healthy");
    expect(res.publicRoute.status).toBe("ok");
    expect(res.status).toBe("ok");
  });

  it("ONLY_TVBOX_MAX_TUNNEL: limita suporte de Tunnel a TV Box e MAX", async () => {
    for (const otherId of ["desktop", "pocket", "baby", "mini", "note"]) {
      const res = await getStationTunnelStatus({
        stationId: otherId,
        fetchImpl: async () => new Response("", { status: 500 }),
      });
      expect(res.status).toBe("unsupported");
      expect(res.tunnel.name).toBe("");
    }
  });
});
