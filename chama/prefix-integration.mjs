#!/usr/bin/env node
process.env.NODE_ENV = "test";
/**
 * Real prefix integration test for HESTIA station base-path support.
 *
 * Topology:
 *   [Hestia Station Client] → http://127.0.0.1:PROXY_PORT/station/api/station/health
 *                                          │
 *                                          ▼
 *                                  [Local reverse proxy]
 *                                          │  strips /station
 *                                          ▼
 *                          http://127.0.0.1:AGENT_PORT/api/station/health
 *                                          │
 *                                          ▼
 *                              [Hestia Station Agent (observer)]
 *
 * Uses the SAME Hestia modules the Console would use
 * (resolveNamedStationConfig + fetchStationHealth). Asserts:
 *   - Client authenticates through prefix.
 *   - Health endpoint returns the canonical contract.
 *   - No-token request returns 401.
 *   - Wrong-token request returns 403.
 */
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveNamedStationConfig,
  fetchStationHealth,
  fetchStationServicesStatus,
  fetchStationSystemStatus,
  STATION_CODES,
} from "../chama/stationClient.js";
import { startStationAgent } from "../chama/stationAgent.js";
import { tmpdir as osTmpdir } from "node:os";

const TOKEN = "integration-test-token-" + Math.random().toString(16).slice(2);

async function freePort() {
  const s = http.createServer();
  await new Promise((r, j) => s.once("error", j) || s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

function startProxy(prefix, target) {
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith(prefix + "/") && req.url !== prefix) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "proxy_prefix_miss" }));
      return;
    }
    const stripped = req.url.slice(prefix.length) || "/";
    const opts = {
      hostname: target.host,
      port: target.port,
      path: stripped,
      method: req.method,
      headers: req.headers,
    };
    // Rewrite Host header to match the backend (so the Station Agent Host
    // Guard accepts the upstream request).
    const headers = { ...req.headers, host: `${target.host}:${target.port}` };
    opts.headers = headers;
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "proxy_error", detail: err.message }));
    });
    req.pipe(proxyReq);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function main() {
  const root = mkdtempSync(join(osTmpdir(), "hestia-prefix-it-"));
  process.env.HESTIA_DATA_DIR = root;
  process.env.HESTIA_STATION_TOKEN = TOKEN;
  process.env.HESTIA_STATION_HOST = "127.0.0.1";
  process.env.HESTIA_STATION_PORT = "0";
  process.env.HESTIA_STATION_READ_ONLY = "1";

  (async () => {
    const agent = await startStationAgent({
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedHosts: "",
      readOnly: true,
      storagePath: "/nonexistent-kaos-path",
      dataDir: root,
      services: ["tailscaled"],
    });
    const agentPort = agent.server.address().port;
    const proxy = await startProxy("/station", { host: "127.0.0.1", port: agentPort });
    const proxyPort = proxy.address().port;
    const baseUrl = `http://127.0.0.1:${proxyPort}/station`;

    const results = [];

    // 1. Valid Bearer via prefix → 200 with canonical contract.
    const cfg = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: baseUrl,
      HESTIA_DESKTOP_TOKEN: TOKEN,
    });
    if (!cfg.valid) {
      console.error("FAIL: cfg invalid", cfg);
      process.exit(1);
    }
    const health = await fetchStationHealth(cfg);
    results.push(["health_through_prefix", health.ok === true, health.code]);

    const services = await fetchStationServicesStatus(cfg);
    results.push(["services_through_prefix", services.ok === true, services.code]);

    const system = await fetchStationSystemStatus(cfg);
    results.push(["system_through_prefix", system.ok === true, system.code]);

    // 2. No Bearer → failure (auth_required)
    const noAuthCfg = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: baseUrl,
      HESTIA_DESKTOP_TOKEN: "",
    });
    const noAuthHealth = await fetchStationHealth(noAuthCfg);
    results.push([
      "no_auth_misconfigured",
      !noAuthHealth.ok && noAuthHealth.code === STATION_CODES.MISCONFIGURED,
      noAuthHealth.code,
    ]);

    // 3. Wrong Bearer → 403
    const badAuthCfg = resolveNamedStationConfig("desktop", {
      HESTIA_DESKTOP_BASE_URL: baseUrl,
      HESTIA_DESKTOP_TOKEN: "wrong-token",
    });
    const badHealth = await fetchStationHealth(badAuthCfg);
    results.push([
      "wrong_auth_unauthorized",
      !badHealth.ok && badHealth.code === STATION_CODES.AUTH_FAILED,
      badHealth.code,
    ]);

    // 4. Path OUTSIDE prefix should be rejected by proxy (404)
    const outsidePath = await new Promise((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: "/not-station/health",
          method: "GET",
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on("error", (e) => resolve({ status: -1, body: e.message }));
      req.end();
    });
    results.push([
      "outside_prefix_rejected_by_proxy",
      outsidePath.status === 404,
      `HTTP ${outsidePath.status}`,
    ]);

    // 5. Direct agent access (no prefix) should also work (loopback)
    const directHealth = await fetch(`http://127.0.0.1:${agentPort}/api/station/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    results.push([
      "direct_agent_health",
      directHealth.status === 200,
      `HTTP ${directHealth.status}`,
    ]);

    console.log("\n=== Real prefix integration test ===");
    let pass = 0;
    for (const [name, ok, detail] of results) {
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
      if (ok) pass++;
    }
    console.log(`\n${pass}/${results.length} passed`);

    await agent.close();
    proxy.close();
    process.exit(pass === results.length ? 0 : 1);
  })().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
}

main();
