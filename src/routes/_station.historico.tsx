import { createFileRoute } from "@tanstack/react-router";
import { hestiaApi } from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";

export const Route = createFileRoute("/_station/historico")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Linha do Tempo" },
      {
        name: "description",
        content: "Linha do tempo operacional das Stations e serviços da Héstia.",
      },
      { property: "og:title", content: "Héstia Console — Linha do Tempo" },
    ],
  }),
  component: TimelinePage,
});

function formatDuration(ms?: number) {
  if (ms == null) return "";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function eventIcon(type: string) {
  if (type === "station.down" || type === "service.down") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-950 border border-red-500 text-red-500 text-xs font-bold">
        ↓
      </span>
    );
  }
  if (type === "station.up" || type === "service.up") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-950 border border-emerald-500 text-emerald-500 text-xs font-bold">
        ↑
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 border border-neutral-600 text-neutral-400 text-xs font-bold">
      •
    </span>
  );
}

export function TimelinePage() {
  const { state, retry, refreshing } = useApi(() => hestiaApi.recentEvents(100), []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kaline-eyebrow">/historico</p>
          <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
            Linha do Tempo Operacional
          </h1>
          <p className="mt-2 text-[13px] text-[color:var(--kaline-muted)] max-w-2xl">
            Histórico determinístico de incidentes, recuperações e eventos relevantes das seis
            Stations da Héstia.
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={refreshing}
          className="rounded border border-[color:var(--kaline-border-copper)] px-3 py-1.5 text-xs text-[color:var(--kaline-copper)] disabled:opacity-60"
        >
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
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
        <div className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/60 p-6 overflow-hidden">
          {state.data.events.length === 0 ? (
            <p className="text-[color:var(--kaline-faint)] text-[13px]">
              Sem eventos registrados na linha do tempo.
            </p>
          ) : (
            <div className="relative border-l border-[color:var(--kaline-border-copper)]/30 ml-3 pl-8 space-y-8">
              {state.data.events.map((it, i) => {
                const isDown = it.type.endsWith(".down");
                const isUp = it.type.endsWith(".up");
                const isStation = it.type.startsWith("station");
                const targetName = isStation ? it.data?.station : it.data?.service;

                let humanType = it.type;
                if (it.type === "station.down") {
                  if (
                    it.data?.to === "expected_offline" ||
                    it.data?.code === "STATION_NOT_CONFIGURED"
                  ) {
                    humanType = `Estação ${targetName?.toUpperCase()} suspensa / offline por escolha`;
                  } else {
                    humanType = `Estação ${targetName?.toUpperCase()} offline`;
                    if (it.data?.code === "AUTH_FAILED") {
                      humanType += " (Falha de Autenticação)";
                    }
                  }
                } else if (it.type === "station.up") {
                  humanType = `Estação ${targetName?.toUpperCase()} desperta / online`;
                } else if (it.type === "service.down") {
                  humanType = `Serviço ${targetName} offline`;
                } else if (it.type === "service.up") {
                  humanType = `Serviço ${targetName} ativo`;
                }

                const durationStr = formatDuration(it.data?.durationMs);

                return (
                  <div key={i} className="relative">
                    <span className="absolute -left-[44px] top-0.5 bg-[color:var(--kaline-obsidian)]">
                      {eventIcon(it.type)}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-semibold text-sm ${isDown ? "text-red-400" : isUp ? "text-emerald-400" : "text-[color:var(--kaline-text)]"}`}
                        >
                          {humanType}
                        </span>
                        {durationStr && (
                          <span className="text-xs px-2 py-0.5 rounded bg-[color:var(--kaline-copper)]/10 text-[color:var(--kaline-copper)] font-mono">
                            duração: {durationStr}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[color:var(--kaline-muted)] mt-1">
                        {new Date(it.timestamp).toLocaleString("pt-BR")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
