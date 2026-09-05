import { describe, it, expect } from "vitest";
import {
  buildDownloadFilename,
  buildReadableDetails,
  formatJson,
  stableStringify,
} from "@/components/hestia/shared/UnavailableNote";
import type { ApiErrorDetails } from "@/lib/hestia/api";

describe("stableStringify", () => {
  it("orders keys alphabetically at any depth", () => {
    const a = stableStringify({ b: 1, a: 2, c: { z: 1, a: 2 } });
    const b = stableStringify({ c: { a: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe(
      ["{", '  "a": 2,', '  "b": 1,', '  "c": {', '    "a": 2,', '    "z": 1', "  }", "}"].join(
        "\n",
      ),
    );
  });

  it("preserves array element order", () => {
    expect(stableStringify({ items: [3, 1, 2] })).toContain(
      '"items": [\n    3,\n    1,\n    2\n  ]',
    );
  });

  it("handles circular refs without throwing", () => {
    const obj: Record<string, unknown> = { name: "x" };
    obj.self = obj;
    const out = stableStringify(obj);
    expect(out).toContain('"self": "[Circular]"');
    expect(out).toContain('"name": "x"');
  });
});

describe("buildDownloadFilename", () => {
  const baseDetails: ApiErrorDetails = {
    origin: "http",
    route: "/api/server/status",
    httpStatus: 500,
    code: "ENOENT",
    at: "2026-07-02T17:00:00Z",
  };

  it("uses route slug, error type and timestamp", () => {
    const name = buildDownloadFilename(baseDetails);
    expect(name).toBe("hestia-api_server_status-http_ENOENT-2026-07-02T17-00-00.json");
  });

  it("falls back to error slug when route is absent", () => {
    const name = buildDownloadFilename({ origin: "http", httpStatus: 503 });
    expect(name).toMatch(/^hestia-error-http_503-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
  });

  it("sanitizes special characters in route", () => {
    const name = buildDownloadFilename({ ...baseDetails, route: "/api/logs?tail=100" });
    expect(name).toMatch(/^hestia-api_logs_tail_100-http_ENOENT-/);
  });

  it("falls back to error for empty slug after stripping slash", () => {
    const name = buildDownloadFilename({ ...baseDetails, route: "/" });
    expect(name).toMatch(/^hestia-error-http_ENOENT-/);
  });

  it("produces a stable filename for identical errors", () => {
    const name1 = buildDownloadFilename(baseDetails);
    const name2 = buildDownloadFilename(baseDetails);
    expect(name1).toBe(name2);
  });

  it("falls back to current timestamp when at is invalid", () => {
    const name = buildDownloadFilename({ ...baseDetails, at: "not-a-date" });
    expect(name).toMatch(
      /^hestia-api_server_status-http_ENOENT-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/,
    );
  });

  it("truncates very long routes to stay within filesystem limits", () => {
    const longRoute = "/api/" + "x".repeat(300);
    const name = buildDownloadFilename({ ...baseDetails, route: longRoute });
    expect(name.length).toBeLessThan(160);
    expect(name).toMatch(/^hestia-api_xxxx+-http_ENOENT-2026-07-02T17-00-00\.json$/);
  });

  it("collapses consecutive underscores and trims leading/trailing underscores", () => {
    const name = buildDownloadFilename({ ...baseDetails, route: "/api///logs??tail=100" });
    expect(name).toBe("hestia-api_logs_tail_100-http_ENOENT-2026-07-02T17-00-00.json");
  });

  it("uses http_status when code is absent", () => {
    const name = buildDownloadFilename({ origin: "http", route: "/api/health", httpStatus: 502 });
    expect(name).toMatch(/^hestia-api_health-http_502-/);
  });

  it("uses origin label for network, timeout and no-base", () => {
    expect(buildDownloadFilename({ origin: "network", route: "/api/health" })).toMatch(
      /^hestia-api_health-network-/,
    );
    expect(
      buildDownloadFilename({ origin: "timeout", route: "/api/health", timeoutMs: 3000 }),
    ).toMatch(/^hestia-api_health-timeout-/);
    expect(buildDownloadFilename({ origin: "no-base", route: "/api/health" })).toMatch(
      /^hestia-api_health-no_base-/,
    );
  });
});

describe("buildReadableDetails", () => {
  const baseDetails: ApiErrorDetails = {
    origin: "http",
    route: "/api/server/status",
    httpStatus: 500,
    code: "ENOENT",
    error: "Disk read failed",
    detail: "could not read /tmp/logs",
    hint: "Verifique permissões de leitura",
    at: "2026-07-02T17:00:00Z",
  };

  it("produces a human-readable multiline string with all expected fields", () => {
    const text = buildReadableDetails("Server indisponível", baseDetails);
    expect(text).toContain("Héstia Console — detalhes do erro");
    expect(text).toContain("status: http");
    expect(text).toContain("rota: /api/server/status");
    expect(text).toContain("http: 500");
    expect(text).toContain("code: ENOENT");
    expect(text).toContain("error: Disk read failed");
    expect(text).toContain("hint: Verifique permissões de leitura");
    expect(text).toContain("at: 2026-07-02T17:00:00Z");
    expect(text).toContain("timeout: —");
    expect(text).toContain("mensagem: Server indisponível");
  });

  it("renders timeout ms when provided", () => {
    const text = buildReadableDetails(undefined, {
      ...baseDetails,
      origin: "timeout",
      timeoutMs: 3000,
      httpStatus: undefined,
    });
    expect(text).toContain("status: timeout");
    expect(text).toContain("http: —");
    expect(text).toContain("timeout: 3000ms");
    expect(text).toContain("mensagem: —");
  });

  it("falls back to em dashes for missing fields", () => {
    const text = buildReadableDetails(undefined, { origin: "no-base" });
    expect(text).toContain("status: no-base");
    expect(text).toContain("rota: —");
    expect(text).toContain("http: —");
    expect(text).toContain("code: —");
    expect(text).toContain("error: —");
  });
});

describe("formatJson", () => {
  const payload = { z: 1, a: 2, nested: { b: 3, a: 4 } };

  it("returns pretty-printed sorted JSON when compact is false", () => {
    const text = formatJson(payload, false);
    expect(text).toContain('\n  "a": 2,');
    expect(text).toContain('\n    "a": 4,');
    expect(text).not.toMatch(/^\{[^\n]+\}$/);
  });

  it("returns compact sorted JSON when compact is true", () => {
    const text = formatJson(payload, true);
    expect(text).toMatch(/^\{.*\}$/);
    expect(text).not.toContain("\n");
    expect(text).toContain('"a":2');
    expect(text).toContain('"nested":{"a":4,"b":3}');
  });
});
