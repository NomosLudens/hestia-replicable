import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HESTIA } from "@/content/kaline";
import { hestiaApi } from "@/lib/hestia/api";

type Ping = { status: number | "erro"; ok: boolean; ms: number; error?: string };

export const Route = createFileRoute("/_station/endpoints")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Endpoints" },
      { name: "description", content: "Contratos /api expostos pela Chama Local." },
      { property: "og:title", content: "Héstia Console — Endpoints" },
      { property: "og:description", content: "Endpoints modo protegido da Chama Local." },
    ],
  }),
  component: EndpointsPage,
});

function EndpointsPage() {
  const [pings, setPings] = useState<Record<string, Ping | undefined>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    HESTIA.endpoints
      .filter((e) => ["/api/health"].includes(e.path))
      .forEach(async (e) => {
        const p = await hestiaApi.ping(e.path);
        if (!alive) return;
        setPings((prev) => ({ ...prev, [e.path]: p }));
      });
    return () => {
      alive = false;
    };
  }, []);

  const copyCurl = async (path: string) => {
    const cmd = `curl -s ${hestiaApi.absoluteUrl(path)} | jq`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(path);
      setTimeout(() => setCopied((c) => (c === path ? null : c)), 1500);
    } catch {
      /* clipboard bloqueado — ignora */
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="kaline-eyebrow">/endpoints</p>
        <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
          Contratos da Chama
        </h1>
        <p className="text-stone-400 text-sm md:text-base max-w-2xl text-center">
          Endpoints de leitura local da TV Box. Recursos de Estação serão configurados em etapa
          posterior do roadmap de unificação arquitetural.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {HESTIA.endpoints.map((e) => {
          const p = pings[e.path];
          return (
            <div
              key={e.path}
              className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-5 flex flex-col gap-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                {e.method === "GET" ? (
                  <a
                    href={hestiaApi.absoluteUrl(e.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[13.5px] text-[color:var(--kaline-text)] hover:text-[color:var(--kaline-copper)] break-all"
                  >
                    GET {e.path}
                  </a>
                ) : (
                  <span className="font-mono text-[13.5px] text-[color:var(--kaline-text)] break-all">
                    POST {e.path}
                  </span>
                )}
                <span
                  className={
                    "text-[10px] uppercase tracking-[0.22em] " +
                    (p == null
                      ? "text-[color:var(--kaline-faint)]"
                      : p.ok
                        ? "text-[color:var(--kaline-amber)]"
                        : "text-[color:var(--kaline-ember)]")
                  }
                >
                  {p == null
                    ? "consultando"
                    : p.ok
                      ? `ok ${p.status} · ${p.ms}ms`
                      : `erro · ${p.ms}ms`}
                </span>
              </div>
              <p className="text-[12.5px] text-[color:var(--kaline-muted)]">{e.purpose}</p>
              {p?.error && (
                <p className="text-[11px] text-[color:var(--kaline-ember)]">
                  último erro: {p.error}
                </p>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--kaline-faint)] mb-1">
                  campos esperados
                </p>
                <div className="flex flex-wrap gap-1">
                  {e.fields.map((f) => (
                    <span
                      key={f}
                      className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-[color:var(--kaline-border-copper)]/60 text-[color:var(--kaline-muted)]"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <code className="text-[11px] text-[color:var(--kaline-faint)] truncate">
                  {e.method} · {e.group}
                </code>
                <button
                  type="button"
                  onClick={() => copyCurl(e.path)}
                  className="text-[10px] uppercase tracking-[0.22em] px-2.5 py-1 rounded border border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper)]/10 transition"
                >
                  {copied === e.path ? "copiado" : "copiar curl"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
