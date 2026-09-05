import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { hestiaApi } from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";

const TAIL_OPTIONS = [50, 100, 200] as const;

export const Route = createFileRoute("/_station/logs")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Logs" },
      { name: "description", content: "Logs modo protegido da própria Chama Local." },
      { property: "og:title", content: "Héstia Console — Logs" },
      { property: "og:description", content: "Ring buffer da Chama Local, sem logs do sistema." },
    ],
  }),
  component: LogsPage,
});

export function LogsPage() {
  const [tail, setTail] = useState<number>(100);
  const { state, retry, refreshing } = useApi(() => hestiaApi.logs(tail), [tail]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kaline-eyebrow">/logs</p>
          <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
            Logs da Chama Local
          </h1>
          <p className="mt-2 text-[13px] text-[color:var(--kaline-muted)] max-w-2xl">
            Apenas eventos da própria Chama. Não lê journalctl, syslog nem logs de serviços do
            sistema. Sem limpar, sem baixar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--kaline-faint)]">
            tail
          </span>
          {TAIL_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTail(n)}
              className={
                "text-[11px] px-2.5 py-1 rounded border transition " +
                (tail === n
                  ? "border-[color:var(--kaline-copper)] text-[color:var(--kaline-copper)] bg-[color:var(--kaline-copper)]/10"
                  : "border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-copper)]")
              }
            >
              {n}
            </button>
          ))}
        </div>
      </header>

      {state.status === "loading" && (
        <p className="text-[color:var(--kaline-muted)]">consultando…</p>
      )}
      {state.status === "unavailable" && (
        <UnavailableNote
          message={state.message}
          details={state.details}
          onRetry={retry}
          refreshing={refreshing}
        />
      )}
      {state.status === "ok" && (
        <div className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/60 overflow-hidden">
          {state.data.items.length === 0 ? (
            <p className="p-6 text-[color:var(--kaline-faint)] text-[13px]">Sem eventos ainda.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--kaline-border-copper)]/40">
              {state.data.items.map((it, i) => (
                <li key={i} className="flex gap-3 px-4 py-2 font-mono text-[12.5px]">
                  <span className="text-[color:var(--kaline-faint)] shrink-0">
                    {new Date(it.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      it.level === "error"
                        ? "text-[color:var(--kaline-ember)] shrink-0 w-14"
                        : it.level === "warn"
                          ? "text-[color:var(--kaline-amber)] shrink-0 w-14"
                          : "text-[color:var(--kaline-copper)] shrink-0 w-14"
                    }
                  >
                    {it.level}
                  </span>
                  <span className="text-[color:var(--kaline-muted)] break-all">{it.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
