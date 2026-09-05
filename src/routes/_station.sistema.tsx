import { createFileRoute } from "@tanstack/react-router";
import { hestiaApi } from "@/lib/hestia/api";
import { usePollingApi } from "@/lib/hestia/usePollingApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";
import { DataCard } from "@/components/hestia/shared/DataCard";
import { MetricCard } from "@/components/hestia/shared/MetricCard";
import { LiveHardwarePanel } from "@/components/hestia/system/LiveHardwarePanel";
import { HardwareConfigPanel } from "@/components/hestia/system/HardwareConfigPanel";

export const Route = createFileRoute("/_station/sistema")({ component: SistemaPage });
function SistemaPage() {
  const status = usePollingApi(hestiaApi.hardwareStatus, 5000);
  const config = usePollingApi(hestiaApi.hardwareConfig, 30000);
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="kaline-eyebrow">/sistema</p>
          <h1 className="kaline-serif text-3xl text-[color:var(--kaline-text)]">
            Saúde e configuração real
          </h1>
          <p className="text-[13px] text-[color:var(--kaline-muted)]">
            Polling leve. Última leitura:{" "}
            {status.lastUpdated ? new Date(status.lastUpdated).toLocaleString() : "não disponível"}
          </p>
        </div>
        <button
          onClick={status.retry}
          className="press-scale rounded border border-[color:var(--kaline-border-copper)] px-3 py-2 text-xs text-[color:var(--kaline-copper)]"
        >
          Atualizar
        </button>
      </header>
      {status.state.status === "ok" ? (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard
              label="geral"
              value={status.state.data.overall.status}
              status={status.state.data.overall.status}
              detail={status.state.data.overall.reasons.join(" · ") || "sistema estável"}
            />
            <MetricCard
              label="CPU"
              value={status.state.data.cpu.loadRatio1m ?? "não disponível"}
              status={status.state.data.cpu.status}
              detail={`${status.state.data.cpu.cores} cores · ${status.state.data.cpu.threads} threads`}
            />
            <MetricCard
              label="RAM"
              value={`${status.state.data.memory.usedPercent}%`}
              status={status.state.data.memory.status}
            />
            <MetricCard
              label="temperatura"
              value={
                status.state.data.temperature.available
                  ? `${status.state.data.temperature.maxC?.toFixed(1)}°C`
                  : "não disponível"
              }
              status={status.state.data.temperature.status}
            />
          </section>
          <DataCard
            title="Saúde em tempo real"
            eyebrow={status.refreshing ? "atualizando" : "hardware"}
            status="ok"
            defaultOpen
          >
            <LiveHardwarePanel data={status.state.data} />
          </DataCard>
        </>
      ) : status.state.status === "unavailable" ? (
        <UnavailableNote
          message={status.state.message}
          details={status.state.details}
          onRetry={status.retry}
          refreshing={status.refreshing}
        />
      ) : (
        <p>consultando…</p>
      )}
      <DataCard
        title="Configuração real"
        eyebrow="host"
        status={
          config.state.status === "ok"
            ? "ok"
            : config.state.status === "unavailable"
              ? "error"
              : "loading"
        }
        defaultOpen
      >
        {config.state.status === "ok" ? (
          <HardwareConfigPanel data={config.state.data} />
        ) : config.state.status === "unavailable" ? (
          <UnavailableNote
            message={config.state.message}
            details={config.state.details}
            onRetry={config.retry}
            refreshing={config.refreshing}
          />
        ) : (
          <p>consultando…</p>
        )}
      </DataCard>
    </div>
  );
}
