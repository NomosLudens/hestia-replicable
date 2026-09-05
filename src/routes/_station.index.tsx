import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  hestiaApi,
  type ApiState,
  type StationConnection,
  type StationId,
  type StationStorage,
  type StationSystem,
  type PresenceEvent,
  type PresenceEventsResult,
  type Config,
  type WakeExecutorStatus,
  STATION_IDS,
  countOnlineStations,
} from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { DataCard } from "@/components/hestia/shared/DataCard";
import { Row } from "@/components/hestia/shared/Row";
import { InfoTooltip, InfoBadge } from "@/components/kaline/InfoTooltip";
import { findEventEntry } from "@/lib/kaline/glossary";

export const Route = createFileRoute("/_station/")({ component: Painel });

export const STATION_UI: Array<{
  id: StationId;
  title: string;
  role: string;
  canonicalStorage: boolean;
  codice: boolean;
  tunnelMonitored: boolean;
  onDemand: boolean;
}> = [
  {
    id: "desktop",
    title: "Servidor",
    role: "/KALINE · backup · processamento · serviços pesados sob demanda · Ash Gate",
    canonicalStorage: true,
    codice: false,
    tunnelMonitored: false,
    onDemand: true,
  },
  {
    id: "tvbox",
    title: "TV Box",
    role: "Ash runtime · infraestrutura doméstica",
    canonicalStorage: true,
    codice: false,
    tunnelMonitored: true,
    onDemand: false,
  },
  {
    id: "pocket",
    title: "Pocket",
    role: "ZeroClaw · Khora",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: false,
    onDemand: false,
  },
  {
    id: "baby",
    title: "Baby",
    role: "Reserva cloud",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: false,
    onDemand: false,
  },
  {
    id: "mini",
    title: "Mini",
    role: "Kódice",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: false,
    onDemand: false,
  },
  {
    id: "max",
    title: "Max",
    role: "Cauldron / Kallistis VTT",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: true,
    onDemand: true,
  },
  {
    id: "note",
    title: "Notebook",
    role: "Workstation principal de desenvolvimento",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: false,
    onDemand: false,
  },
  {
    id: "kaos",
    title: "KAOS",
    role: "Observer / Witness — Blackbox + Experience + Witness + Internet Observatory",
    canonicalStorage: false,
    codice: false,
    tunnelMonitored: false,
    onDemand: false,
  },
];

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

function EventExplainTooltip({ type }: { type: string }) {
  const entry = findEventEntry(type);
  return (
    <InfoTooltip
      position="right"
      ariaLabel={`o que significa ${type}`}
      content={
        <span className="block">
          <span className="block font-mono font-semibold text-sky-300 mb-1">{type}</span>
          {entry ? (
            <>
              <span className="block font-medium text-zinc-100 mb-1">{entry.title}</span>
              <span className="block text-zinc-300">{entry.detail}</span>
            </>
          ) : (
            <span className="block text-zinc-300">
              Evento fora do glossário atual. Tipo genérico do Guardião — sem descrição adicional.
            </span>
          )}
        </span>
      }
    >
      <InfoBadge className="ml-1.5 align-text-bottom opacity-60 hover:opacity-100" />
    </InfoTooltip>
  );
}

const ON_DEMAND_IDS = new Set(STATION_UI.filter((s) => s.onDemand).map((s) => s.id as string));

export type GuardianSummaryState = "stable" | "attention" | "partial";

function deriveInfrastructureSummary({
  connections,
  configuredIds,
  activeIncidentCount,
  wakeExecutor,
}: {
  connections: Record<StationId, StationConnection | null>;
  configuredIds: StationId[];
  activeIncidentCount: number;
  wakeExecutor: WakeExecutorStatus;
}) {
  const observed = configuredIds.map((id) => connections[id]);
  const unknownCount = observed.filter((connection) => !connection).length;
  const problematic = observed.some((connection, index) => {
    if (!connection) return false;
    const id = configuredIds[index];
    return (
      connection.state === "unauthorized" ||
      connection.state === "misconfigured" ||
      (connection.state === "unavailable" && !ON_DEMAND_IDS.has(id))
    );
  });
  const state: GuardianSummaryState =
    activeIncidentCount > 0 ||
    problematic ||
    wakeExecutor.state === "unavailable" ||
    wakeExecutor.state === "misconfigured"
      ? "attention"
      : unknownCount > 0 || wakeExecutor.state === "unknown"
        ? "partial"
        : "stable";
  return {
    state,
    configuredCount: configuredIds.length,
    availableCount: Object.values(connections).filter(
      (connection) => connection?.state === "available",
    ).length,
    unavailableCount: Object.values(connections).filter(
      (connection) => connection?.state === "unavailable",
    ).length,
    unknownCount,
  };
}

function computeGuardianSummary(events: PresenceEvent[]) {
  const activeIncidents: Array<{ type: string; name: string; timestamp: string; code?: string }> =
    [];
  const recentRecoveries: Array<{
    type: string;
    name: string;
    timestamp: string;
    durationMs?: number;
  }> = [];
  let wakeRequestedEvent: PresenceEvent | null = null;

  const seen = new Set<string>();

  for (const event of events) {
    if (event.type === "wake.requested" && !wakeRequestedEvent) {
      wakeRequestedEvent = event;
    }
    const isDown = event.type.endsWith(".down");
    const isUp = event.type.endsWith(".up");
    const isStation = event.type.startsWith("station");
    const name = isStation ? event.data?.station : event.data?.service;

    if (!name) continue;

    const key = `${event.type.split(".")[0]}:${name}`;

    if (isUp) {
      if (!seen.has(key)) {
        seen.add(key);
        recentRecoveries.push({
          type: event.type,
          name,
          timestamp: event.timestamp,
          durationMs: event.data?.durationMs,
        });
      }
    } else if (isDown) {
      const isResolved = seen.has(event.type.replace(".down", ".up"));
      const isExplicitWakeFailed = event.data?.code === "WAKE_FAILED";
      const isOnDemandResting = isStation && ON_DEMAND_IDS.has(name) && !isExplicitWakeFailed;

      if (!isResolved && !seen.has(key) && !isOnDemandResting) {
        seen.add(key);
        activeIncidents.push({
          type: event.type,
          name,
          timestamp: event.timestamp,
          code: event.data?.code,
        });
      }
    }
  }

  return { activeIncidents, recentRecoveries, wakeRequestedEvent };
}

function GuardianSummaryCard({
  configState,
  eventsState,
  connectionsState,
  executorState,
}: {
  configState: ApiState<Config>;
  eventsState: ApiState<PresenceEventsResult>;
  connectionsState: ApiState<Record<StationId, ApiState<StationConnection>>>;
  executorState: ApiState<WakeExecutorStatus>;
}) {
  if (
    configState.status === "loading" ||
    eventsState.status === "loading" ||
    connectionsState.status === "loading" ||
    executorState.status === "loading"
  ) {
    return (
      <div className="p-4 rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/40 text-[color:var(--kaline-muted)] text-xs">
        Carregando resumo do guardião…
      </div>
    );
  }
  if (
    configState.status !== "ok" ||
    eventsState.status !== "ok" ||
    connectionsState.status !== "ok" ||
    executorState.status !== "ok"
  ) {
    return null;
  }

  const config = configState.data;
  const events = eventsState.data.events;

  const { activeIncidents, recentRecoveries, wakeRequestedEvent } = computeGuardianSummary(events);

  const configuredCount = STATION_IDS.filter((id) => config[`${id}Configured`]).length;
  const activeStationIncidents = activeIncidents.filter((i) => i.type.startsWith("station"));
  const connectionData = Object.fromEntries(
    STATION_IDS.map((id) => [
      id,
      connectionsState.data[id]?.status === "ok" ? connectionsState.data[id].data : null,
    ]),
  ) as Record<StationId, StationConnection | null>;
  const onlineCount = countOnlineStations(connectionData);
  const configuredIds = STATION_IDS.filter((id) => config[`${id}Configured`]);
  const current = deriveInfrastructureSummary({
    connections: connectionData,
    configuredIds,
    activeIncidentCount: activeIncidents.length,
    wakeExecutor: executorState.data,
  });
  const hasCritical = current.state === "attention";
  const badge =
    current.state === "stable"
      ? "Estado atual estável"
      : current.state === "attention"
        ? "Atenção necessária"
        : "Estado atual parcial";

  return (
    <div
      className={`p-5 rounded-xl border ${
        hasCritical
          ? "border-red-900/60 bg-red-950/10"
          : "border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/40"
      } space-y-4`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--kaline-text)]">
          Resumo do Guardião
        </h2>
        <span
          className={`text-xs px-2.5 py-0.5 rounded font-mono ${
            hasCritical
              ? "bg-red-500/10 text-red-400 border border-red-500/20"
              : current.state === "partial"
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          }`}
        >
          {badge}
        </span>
      </div>

      <div className="space-y-2.5 text-xs text-[color:var(--kaline-muted)]">
        {/* 1. Wake Event Status */}
        {wakeRequestedEvent && (
          <div className="flex items-start gap-2 text-amber-400">
            <span className="font-bold">•</span>
            <span>
              <strong>Despertar solicitado:</strong> Aguardando resposta do servidor desde{" "}
              {new Date(wakeRequestedEvent.timestamp).toLocaleTimeString()})
              <EventExplainTooltip type="wake.requested" />
            </span>
          </div>
        )}

        {/* 2. Active Incidents */}
        <div className="text-[11px] text-[color:var(--kaline-faint)]">
          Estado atual: {current.configuredCount} configuradas · {current.availableCount}{" "}
          disponíveis · {current.unavailableCount} indisponíveis · {current.unknownCount} não
          determinado
        </div>
        {activeIncidents.map((incident, idx) => {
          const isStation = incident.type.startsWith("station");
          const target = isStation ? incident.name.toUpperCase() : incident.name;
          const displayCode = incident.code === "AUTH_FAILED" ? " (Erro de Autenticação)" : "";
          return (
            <div key={idx} className="flex items-start gap-2 text-red-400">
              <span className="font-bold">•</span>
              <span>
                <strong>Incidente ativo:</strong>{" "}
                {isStation ? `Estação ${target}` : `Serviço ${target}`} offline desde{" "}
                {new Date(incident.timestamp).toLocaleTimeString()}
                {displayCode}
                <EventExplainTooltip type={incident.type} />
              </span>
            </div>
          );
        })}

        {/* 3. Nodes Offline Unexpectedly */}
        {activeStationIncidents.length > 0 && (
          <div className="text-[11px] text-red-500/80 italic pl-3">
            Atenção: {activeStationIncidents.length} de {configuredCount} nós configurados
            encontram-se offline de forma inesperada.
          </div>
        )}

        {/* 4. Recent Recoveries */}
        {recentRecoveries.slice(0, 3).map((recovery, idx) => {
          const isStation = recovery.type.startsWith("station");
          const target = isStation ? recovery.name.toUpperCase() : recovery.name;
          const durationStr = formatDuration(recovery.durationMs);
          return (
            <div key={idx} className="flex items-start gap-2 text-emerald-400/95">
              <span className="font-bold">•</span>
              <span>
                {isStation ? `Estação ${target}` : `Serviço ${target}`} recuperado(a)
                {durationStr ? ` após ${durationStr}` : ""}
                <EventExplainTooltip type={recovery.type} />
              </span>
            </div>
          );
        })}

        {/* 5. Nodes Offline by Choice */}
        {(!config.maxConfigured || !config.maxAuthConfigured) && (
          <div className="flex items-start gap-2 text-[color:var(--kaline-faint)]">
            <span>•</span>
            <span>
              MAX suspensa / offline por escolha (computação cloud sob demanda disponível para
              despertar).
            </span>
          </div>
        )}

        {/* 6. General State */}
        <div className="pt-2 border-t border-[color:var(--kaline-border-copper)]/10 text-[11px] text-[color:var(--kaline-faint)] flex justify-between">
          <span>
            {onlineCount} de {STATION_IDS.length} nós observados online ({configuredCount}{" "}
            configurados)
          </span>
          <span>Héstia observa e solicita · Guardião resume o estado observado</span>
        </div>
      </div>
    </div>
  );
}

export function Painel() {
  const { state: configState } = useApi(() => hestiaApi.config(), []);
  const { state: eventsState } = useApi(() => hestiaApi.recentEvents(50), []);
  const {
    state: connectionsState,
    retry: retryConnections,
    refreshing: refreshingConnections,
  } = useApi<Record<StationId, ApiState<StationConnection>>>(async () => {
    const results = await Promise.all(
      STATION_IDS.map(async (id) => [id, await hestiaApi.stationConnection(id)] as const),
    );
    return {
      status: "ok",
      data: Object.fromEntries(results) as Record<StationId, ApiState<StationConnection>>,
      fetchedAt: new Date().toISOString(),
    };
  }, []);
  const { state: executorState } = useApi<WakeExecutorStatus>(
    () => hestiaApi.wakeExecutorStatus(),
    [],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!refreshingConnections) retryConnections();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [refreshingConnections, retryConnections]);

  return (
    <div className="space-y-6">
      <header>
        <p className="kaline-eyebrow">Console Héstia · Host MELLON</p>
        <h1 className="kaline-serif text-3xl text-[color:var(--kaline-text)]">Héstia</h1>
        <p className="text-[13px] text-[color:var(--kaline-muted)]">
          Monitoramento independente e somente leitura das {STATION_IDS.length} Stations da Héstia.
        </p>
      </header>

      <GuardianSummaryCard
        configState={configState}
        eventsState={eventsState}
        connectionsState={connectionsState}
        executorState={executorState}
      />

      <WakeExecutorCard state={executorState} />

      <section className="grid gap-4 xl:grid-cols-2">
        {STATION_UI.map((station) => (
          <StationCard
            key={station.id}
            {...station}
            sharedConnectionState={
              connectionsState.status === "ok"
                ? connectionsState.data[station.id]
                : { status: "loading" }
            }
            onRetryConnection={retryConnections}
            connectionRefreshing={refreshingConnections}
          />
        ))}
      </section>
    </div>
  );
}

function WakeExecutorCard({ state }: { state: ApiState<WakeExecutorStatus> }) {
  const status = state.status === "ok" ? state.data : null;
  const label =
    status?.state === "available"
      ? "Canal ADB alcançável"
      : status?.state === "unavailable"
        ? "Canal ADB não respondeu"
        : status?.state === "misconfigured"
          ? "Configuração ausente ou inválida"
          : "Estado não determinado";
  const color =
    status?.state === "available"
      ? "text-emerald-400"
      : status?.state === "unavailable" || status?.state === "misconfigured"
        ? "text-red-400"
        : "text-amber-400";
  return (
    <section className="p-4 rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/40">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--kaline-muted)]">
        Infraestrutura auxiliar · Executor WAKE
      </p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm text-[color:var(--kaline-text)]">INOVA</h2>
          <p className={`text-xs ${color}`}>
            {state.status === "ok" ? label : "Observação indisponível"}
          </p>
        </div>
        <p className="text-[11px] text-[color:var(--kaline-faint)] text-right">
          Canal TCP observado · não confirma o despertar
          <br />
          {status ? `Verificado às ${new Date(status.checkedAt).toLocaleTimeString()}` : ""}
        </p>
      </div>
    </section>
  );
}

export function StationCard({
  id,
  title,
  role,
  canonicalStorage,
  codice,
  tunnelMonitored,
  onDemand,
  sharedConnectionState,
  onRetryConnection,
  connectionRefreshing,
}: {
  id: StationId;
  title: string;
  role: string;
  canonicalStorage: boolean;
  codice: boolean;
  tunnelMonitored: boolean;
  onDemand: boolean;
  sharedConnectionState?: ApiState<StationConnection>;
  onRetryConnection?: () => void;
  connectionRefreshing?: boolean;
}) {
  const connection = useApi(
    async () => sharedConnectionState || hestiaApi.stationConnection(id),
    [id, sharedConnectionState],
  );
  const system = useApi(() => hestiaApi.stationSystem(id), [id]);
  const storage = useApi(
    canonicalStorage
      ? () => hestiaApi.stationStorage(id)
      : async () => ({ status: "idle" as const }),
    [id, canonicalStorage],
  );
  const services = useApi(() => hestiaApi.stationServices(id), [id]);
  // Somente KAOS consome o report completo de inventário do systemd.
  const servicesReport = useApi(
    id === "kaos"
      ? () => hestiaApi.stationServicesReport(id)
      : async () => ({ status: "idle" as const }),
    [id],
  );
  const codiceHealth = useApi(
    codice ? hestiaApi.tvboxCodiceHealth : async () => ({ status: "idle" as const }),
    [codice],
  );
  const tunnel = useApi(
    tunnelMonitored
      ? () => hestiaApi.stationTunnelStatus(id)
      : async () => ({ status: "idle" as const }),
    [id, tunnelMonitored],
  );
  const refreshing =
    connectionRefreshing ||
    connection.refreshing ||
    system.refreshing ||
    (canonicalStorage && storage.refreshing) ||
    services.refreshing ||
    (id === "kaos" && servicesReport.refreshing) ||
    (codice && codiceHealth.refreshing) ||
    (tunnelMonitored && tunnel.refreshing);
  const retry = () => {
    if (onRetryConnection) onRetryConnection();
    if (!sharedConnectionState) connection.retry();
    system.retry();
    if (canonicalStorage) storage.retry();
    services.retry();
    if (id === "kaos") servicesReport.retry();
    if (codice) codiceHealth.retry();
    if (tunnelMonitored) tunnel.retry();
  };
  const connectionState =
    connection.state.status === "ok" ? connection.state.data.state : "loading";
  const agent = connection.state.status === "ok" ? connection.state.data.station : null;
  const cardState = stationCardState(connection.state, onDemand);

  const [wakeState, setWakeState] = useState<{
    loading: boolean;
    waking?: boolean;
    sleeping?: boolean;
    attempt?: number;
    message?: string;
    error?: string;
  }>({ loading: false });

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPollTimer();
  }, []);

  useEffect(() => {
    if (
      wakeState.waking &&
      connection.state.status === "ok" &&
      connection.state.data.state === "available"
    ) {
      clearPollTimer();
      setWakeState({ loading: false, waking: false, message: "Servidor disponível." });
    } else if (
      wakeState.sleeping &&
      connection.state.status === "ok" &&
      connection.state.data.state === "unavailable"
    ) {
      clearPollTimer();
      setWakeState({
        loading: false,
        sleeping: false,
        message: "Servidor indisponível após a solicitação de repouso.",
      });
    }
  }, [connection.state, wakeState.waking, wakeState.sleeping]);

  const handleWakeServer = async () => {
    clearPollTimer();
    setWakeState({ loading: true, message: "Solicitando despertar…" });
    const res = await hestiaApi.wakeServer();
    if (res.status === "ok" && res.data.ok) {
      let attempt = 1;
      const maxAttempts = 12;
      setWakeState({
        loading: true,
        waking: true,
        attempt: 1,
        message: `Solicitação aceita. Aguardando confirmação do servidor (${attempt}/${maxAttempts})…`,
      });
      retry();

      pollTimerRef.current = setInterval(async () => {
        attempt += 1;
        if (attempt > maxAttempts) {
          clearPollTimer();
          setWakeState({
            loading: false,
            waking: false,
            error: "Solicitação aceita, mas o despertar não foi confirmado após 60s.",
          });
        } else {
          setWakeState((prev) => ({
            ...prev,
            attempt,
            message: `Solicitação aceita. Aguardando confirmação do servidor (${attempt}/${maxAttempts})…`,
          }));
          retry();
        }
      }, 5000);
    } else {
      const err =
        res.status === "unavailable"
          ? res.message
          : res.status === "ok"
            ? res.data.error || "Falha ao solicitar despertar"
            : "Erro de conexão";
      setWakeState({ loading: false, error: err });
    }
  };

  const handleSleepServer = async () => {
    clearPollTimer();
    setWakeState({ loading: true, message: "Solicitando repouso do Servidor…" });
    const res = await hestiaApi.sleepServer();
    if (res.status === "ok" && res.data.ok) {
      let attempt = 1;
      const maxAttempts = 8;
      setWakeState({
        loading: true,
        sleeping: true,
        attempt: 1,
        message: "Solicitação aceita. Aguardando confirmação de repouso…",
      });
      retry();

      pollTimerRef.current = setInterval(async () => {
        attempt += 1;
        if (attempt > maxAttempts) {
          clearPollTimer();
          setWakeState({
            loading: false,
            sleeping: false,
            error: "Solicitação aceita, mas o repouso não foi confirmado.",
          });
        } else {
          retry();
        }
      }, 3000);
    } else {
      const err =
        res.status === "unavailable"
          ? res.message
          : res.status === "ok"
            ? res.data.error || "Falha ao solicitar repouso"
            : "Erro de conexão";
      setWakeState({ loading: false, error: err });
    }
  };

  return (
    <DataCard title={title} eyebrow={role} status={cardState.status} summary={cardState.summary}>
      <ConnectionRows state={connection.state} />
      <Row
        k="Station Agent"
        v={agent ? "disponível" : connectionState === "loading" ? "consultando…" : "indisponível"}
      />
      <Row k="Versão do Agent" v={agent?.version || "—"} />
      <SystemRows state={system.state} />
      <Row
        k={canonicalStorage ? "Armazenamento /KALINE" : "Disco raiz agregado"}
        v={
          canonicalStorage
            ? storageLabel(storage.state as ApiState<StationStorage>)
            : rootDiskLabel(system.state)
        }
      />
      {services.state.status === "ok" ? (
        services.state.data.services.length > 0 ? (
          services.state.data.services.map((service) => (
            <Row key={service.id} k={service.id} v={service.status} />
          ))
        ) : (
          <Row k="Serviços configurados" v="—" />
        )
      ) : (
        <Row
          k="Serviços configurados"
          v={services.state.status === "loading" ? "consultando…" : "indisponível"}
        />
      )}
      {id === "kaos" &&
        (servicesReport.state.status === "ok" ? (
          <Row
            k="Inventário systemd"
            v={`${servicesReport.state.data.count} unidades · ${servicesReport.state.data.summary.byActiveState.active ?? 0} active · ${servicesReport.state.data.summary.enabledDisabled.enabled} enabled · ${servicesReport.state.data.summary.failed ?? servicesReport.state.data.summary.byActiveState.failed ?? 0} failed`}
          />
        ) : servicesReport.state.status === "loading" ? (
          <Row k="Inventário systemd" v="consultando o systemd real da KAOS…" />
        ) : servicesReport.state.status === "idle" ? null : (
          <Row k="Inventário systemd" v="indisponível" />
        ))}
      {codice && <Row k="Biblioteca Códice" v={codiceLabel(codiceHealth.state)} />}
      {tunnel.state.status === "ok" && tunnel.state.data.tunnel.connected && (
        <>
          <Row
            k="Cloudflare Tunnel"
            v={`${tunnel.state.data.tunnel.name} · ${tunnel.state.data.tunnel.haConnections}/4 HA (${tunnel.state.data.tunnel.protocol})`}
          />
          <Row
            k="Rota Pública"
            v={
              tunnel.state.data.publicRoute.status === "ok"
                ? `${tunnel.state.data.publicRoute.hostname} · PASS (${tunnel.state.data.publicRoute.latencyMs}ms)`
                : tunnel.state.data.publicRoute.status === "not_configured"
                  ? "não configurada"
                  : `${tunnel.state.data.publicRoute.hostname || "pública"} · DEGRADADA`
            }
          />
        </>
      )}
      <Row k="Última atualização" v={latestCheckedAt(connection.state, system.state)} />
      {id === "kaos" && (
        <div className="mt-3">
          <Link
            to="/servicos"
            className="block w-full text-center rounded bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 px-3 py-2 text-xs font-semibold text-sky-300 transition-colors"
          >
            Ver inventário completo de serviços da KAOS →
          </Link>
        </div>
      )}
      {id === "desktop" && (
        <div className="mt-3">
          {cardState.status !== "ok" ? (
            <button
              type="button"
              onClick={handleWakeServer}
              disabled={wakeState.loading}
              className="w-full rounded bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-60 transition-colors"
            >
              {wakeState.waking
                ? `Despertando servidor… (${wakeState.attempt || 1}/12)`
                : wakeState.loading
                  ? "Solicitando despertar…"
                  : "Acordar servidor"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSleepServer}
              disabled={wakeState.loading}
              className="w-full rounded bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-600/40 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-60 transition-colors"
            >
              {wakeState.sleeping
                ? "Colocando em repouso…"
                : wakeState.loading
                  ? "Enviando comando de repouso…"
                  : "Dormir servidor"}
            </button>
          )}
          {wakeState.message && (
            <p className="mt-1.5 text-[11px] text-emerald-400 font-mono">{wakeState.message}</p>
          )}
          {wakeState.error && (
            <p className="mt-1.5 text-[11px] text-red-400 font-mono">{wakeState.error}</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={retry}
        disabled={refreshing}
        className="mt-3 rounded border border-[color:var(--kaline-border-copper)] px-3 py-2 text-xs text-[color:var(--kaline-copper)] disabled:opacity-60"
      >
        {refreshing ? "Verificando…" : `Atualizar ${title}`}
      </button>
    </DataCard>
  );
}

export function stationCardState(
  state: ApiState<StationConnection>,
  onDemand = false,
): {
  summary: string;
  status: "ok" | "loading" | "unavailable" | "warn" | "error";
} {
  if (state.status === "loading") return { summary: "consultando…", status: "loading" };
  if (state.status !== "ok") {
    return onDemand
      ? { summary: "repouso (sob demanda)", status: "warn" }
      : { summary: "offline", status: "unavailable" };
  }
  const meta: Record<
    StationConnection["state"],
    { summary: string; status: "ok" | "unavailable" | "warn" | "error" }
  > = {
    available: { summary: "online", status: "ok" },
    unavailable: onDemand
      ? { summary: "repouso (sob demanda)", status: "warn" }
      : { summary: "offline", status: "unavailable" },
    not_configured: { summary: "não configurada", status: "warn" },
    expected_offline: { summary: "repouso (sob demanda)", status: "warn" },
    misconfigured: { summary: "configuração inválida", status: "error" },
    unauthorized: { summary: "não autorizada", status: "error" },
    incompatible: { summary: "incompatible", status: "error" },
  };
  return meta[state.data.state];
}

function ConnectionRows({ state }: { state: ApiState<StationConnection> }) {
  if (state.status === "loading") return <Row k="Conexão" v="consultando…" />;
  if (state.status !== "ok") return <Row k="Conexão" v="indisponível" />;
  const labels: Record<StationConnection["state"], string> = {
    available: "online",
    unavailable: state.data.code === "STATION_TIMEOUT" ? "timeout" : "offline",
    not_configured: "não configurada",
    expected_offline: "offline por escolha",
    misconfigured: "configuração inválida",
    unauthorized: "não autorizada",
    incompatible: "incompatible",
  };
  return (
    <>
      <Row k="Conexão" v={labels[state.data.state]} />
      <Row k="Latência" v={state.data.latencyMs == null ? "—" : `${state.data.latencyMs} ms`} />
    </>
  );
}

function SystemRows({ state }: { state: ApiState<StationSystem> }) {
  if (state.status === "loading") return <Row k="Sistema" v="consultando…" />;
  if (state.status !== "ok") return <Row k="Sistema" v="indisponível" />;
  const { system } = state.data;
  return (
    <>
      <Row k="Hostname" v={system.hostname} />
      <Row k="Sistema" v={`${system.platform} ${system.release}`} />
      <Row k="Arquitetura" v={system.arch} />
      <Row k="Uptime" v={formatUptime(system.uptimeSeconds)} />
      <Row
        k="CPU"
        v={`${system.cpu.model} · ${system.cpu.threads} threads · ${formatPercent(system.cpu.usagePercent)}`}
      />
      <Row
        k="RAM"
        v={`${formatBytes(system.memory.usedBytes)} / ${formatBytes(system.memory.totalBytes)} (${formatPercent(system.memory.usedPercent)})`}
      />
      <Row
        k="Swap"
        v={`${formatBytes(system.swap.usedBytes)} / ${formatBytes(system.swap.totalBytes)} (${formatPercent(system.swap.usedPercent)})`}
      />
    </>
  );
}

function storageLabel(state: ApiState<StationStorage>) {
  if (state.status === "loading") return "consultando…";
  if (state.status !== "ok") return "indisponível";
  if (state.data.storage.status !== "ok" || state.data.storage.percentUsed == null)
    return state.data.storage.status;
  return `${formatBytes(state.data.storage.usedBytes)} / ${formatBytes(state.data.storage.totalBytes)} (${formatPercent(state.data.storage.percentUsed)})`;
}

function rootDiskLabel(state: ApiState<StationSystem>) {
  if (state.status === "loading") return "consultando…";
  if (state.status !== "ok") return "indisponível";
  const disk = state.data.system.rootDisk;
  return `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)} (${formatPercent(disk.usedPercent)})`;
}

function codiceLabel(state: ApiState<{ formats: string[] }>) {
  if (state.status === "loading") return "consultando…";
  return state.status === "ok" ? state.data.formats.join(", ") : "indisponível";
}

function latestCheckedAt(...states: ApiState<{ checkedAt: string }>[]) {
  const dates = states
    .filter(
      (state): state is ApiState<{ checkedAt: string }> & { status: "ok" } => state.status === "ok",
    )
    .map((state) => state.data.checkedAt)
    .sort();
  return dates.at(-1) || "—";
}

function formatBytes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatPercent(value: number | null) {
  return value == null || !Number.isNaN(value) === false ? "—" : `${value}%`;
}

function formatUptime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}
