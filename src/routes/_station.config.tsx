import { createFileRoute } from "@tanstack/react-router";
import { hestiaApi } from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { HESTIA } from "@/content/kaline";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";
import { Row } from "@/components/hestia/shared/Row";
import { InstallHestiaButton } from "@/components/hestia/InstallHestiaButton";

export const Route = createFileRoute("/_station/config")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Configuração" },
      { name: "description", content: "Configuração modo protegido da Chama Local." },
      { property: "og:title", content: "Héstia Console — Configuração" },
      { property: "og:description", content: "Host, porta, modo e paths observados pela Chama." },
    ],
  }),
  component: ConfigPage,
});

const expected = {
  host: HESTIA.defaultHost,
  port: HESTIA.defaultPort,
  mode: "modo protegido",
  readonly: true,
  agentName: HESTIA.agentName,
};

function ConfigPage() {
  const { state, retry, refreshing } = useApi(hestiaApi.config);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="kaline-eyebrow">/config</p>
          <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
            Configuração da Chama
          </h1>
        </div>
        <InstallHestiaButton />
      </header>

      {state.status === "loading" && (
        <p className="text-[color:var(--kaline-muted)]">consultando…</p>
      )}

      {state.status === "unavailable" && (
        <>
          <UnavailableNote
            message={state.message}
            details={state.details}
            onRetry={retry}
            refreshing={refreshing}
          />
          <div className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-5">
            <p className="kaline-eyebrow">Configuração esperada (não confirmada)</p>
            <div className="mt-3 flex flex-col gap-2">
              <Row k="host" v={expected.host} />
              <Row k="port" v={expected.port} />
              <Row k="mode" v={expected.mode} />
              <Row k="readonly" v={String(expected.readonly)} />
              <Row k="agentName" v={expected.agentName} />
            </div>
          </div>
        </>
      )}

      {state.status === "ok" && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-5 flex flex-col gap-2">
            <p className="kaline-eyebrow">Núcleo</p>
            <Row k="appName" v={state.data.appName} />
            <Row k="serverName" v={state.data.serverName} />
            <Row k="agentName" v={state.data.agentName} />
            <Row k="version" v={state.data.version} />
            <Row k="host" v={state.data.host} />
            <Row k="port" v={state.data.port} />
            <Row k="mode" v={state.data.mode} />
            <Row k="readonly" v={String(state.data.readonly)} />
            <Row k="controlledWrites" v={String(state.data.controlledWrites)} />
            <Row k="lanEnabled" v={String(state.data.lanEnabled)} />
          </div>
          <div className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-5 flex flex-col gap-3">
            <div>
              <p className="kaline-eyebrow">Estação</p>
              <div className="mt-2 flex flex-col gap-2">
                <Row k="Servidor configurado" v={state.data.desktopConfigured ? "sim" : "não"} />
                <Row k="Token do Servidor" v={state.data.desktopAuthConfigured ? "sim" : "não"} />
                <Row k="TV Box configurada" v={state.data.tvboxConfigured ? "sim" : "não"} />
                <Row k="Token da TV Box" v={state.data.tvboxAuthConfigured ? "sim" : "não"} />
                <Row k="Pocket configurada" v={state.data.pocketConfigured ? "sim" : "não"} />
                <Row k="Token da Pocket" v={state.data.pocketAuthConfigured ? "sim" : "não"} />
                <Row k="Baby configurada" v={state.data.babyConfigured ? "sim" : "não"} />
                <Row k="Token da Baby" v={state.data.babyAuthConfigured ? "sim" : "não"} />
                <Row k="Mini configurada" v={state.data.miniConfigured ? "sim" : "não"} />
                <Row k="Token da Mini" v={state.data.miniAuthConfigured ? "sim" : "não"} />
                <Row
                  k="Configuração legada"
                  v={state.data.legacyStationConfigDetected ? "corrigir" : "ausente"}
                />
                <Row k="Timeout" v={`${state.data.stationTimeoutMs} ms`} />
              </div>
            </div>
            <div>
              <p className="kaline-eyebrow">services</p>
              <ul className="mt-2 font-mono text-[13px] text-[color:var(--kaline-muted)]">
                {state.data.services.map((s) => (
                  <li key={s}>· {s}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
