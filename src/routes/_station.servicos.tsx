import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  hestiaApi,
  type StationServiceReportEntry,
  type StationServicesReport,
} from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";
import { DataCard } from "@/components/hestia/shared/DataCard";
import { Row } from "@/components/hestia/shared/Row";
import { InfoTooltip, InfoBadge } from "@/components/kaline/InfoTooltip";
import {
  ACTIVE_STATE_GLOSSARY,
  CATEGORY_LABEL,
  UNIT_FILE_STATE_GLOSSARY,
  describeService,
  findServiceEntry,
  type ServiceGlossaryEntry,
} from "@/lib/kaline/glossary";

export const Route = createFileRoute("/_station/servicos")({
  component: ServicosInventarioKaos,
});

type ActiveFilter =
  | "all"
  | "active"
  | "inactive"
  | "failed"
  | "activating"
  | "deactivating"
  | "reloading"
  | "maintenance"
  | "unknown";
type UnitFileFilter =
  | "all"
  | "enabled"
  | "disabled"
  | "static"
  | "masked"
  | "generated"
  | "transient"
  | "bad"
  | "indirect"
  | "unknown";

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number | null): string {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

function stateBadgeClass(state: string): string {
  if (state === "active") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (state === "failed") return "bg-red-500/15 text-red-300 border-red-500/30";
  if (state === "inactive") return "bg-zinc-700/30 text-zinc-300 border-zinc-500/20";
  if (state === "activating" || state === "reloading")
    return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (state === "deactivating") return "bg-amber-700/15 text-amber-400 border-amber-700/30";
  if (state === "maintenance") return "bg-purple-500/10 text-purple-300 border-purple-500/20";
  return "bg-zinc-800/40 text-zinc-400 border-zinc-600/20";
}

function unitFileBadgeClass(state: string | null): string {
  if (state === "enabled") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (state === "disabled") return "bg-zinc-700/30 text-zinc-300 border-zinc-500/20";
  if (state === "static") return "bg-sky-500/10 text-sky-300 border-sky-500/20";
  if (state === "masked") return "bg-red-900/15 text-red-300 border-red-900/30";
  if (state === "generated" || state === "transient")
    return "bg-violet-500/10 text-violet-300 border-violet-500/20";
  if (state === "bad" || state === "indirect")
    return "bg-red-700/15 text-red-300 border-red-700/30";
  return "bg-zinc-800/40 text-zinc-400 border-zinc-600/20";
}

function StateBadge({
  state,
  glossary,
}: {
  state: string;
  glossary: typeof ACTIVE_STATE_GLOSSARY;
}) {
  const entry = glossary.find((g) => g.state === state);
  return (
    <InfoTooltip
      position="bottom"
      ariaLabel={`explicação de ${state}`}
      content={
        <span className="block">
          <span className="block font-semibold uppercase tracking-wider text-sky-300 mb-1">
            {state}
          </span>
          {entry ? (
            <>
              <span className="block font-medium text-zinc-100 mb-1">{entry.short}</span>
              <span className="block text-zinc-300">{entry.detail}</span>
            </>
          ) : (
            <span className="block text-zinc-300">
              Estado fora da tabela canônica do systemd. Veja a documentação oficial para esta
              string específica.
            </span>
          )}
        </span>
      }
    >
      <span
        className={`inline-flex items-center text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono cursor-help ${stateBadgeClass(state)}`}
      >
        {state}
      </span>
    </InfoTooltip>
  );
}

function UnitFileBadge({ state }: { state: string | null }) {
  const s = state ?? "unknown";
  const entry = UNIT_FILE_STATE_GLOSSARY.find((g) => g.state === s);
  return (
    <InfoTooltip
      position="bottom"
      ariaLabel={`explicação de ${s}`}
      content={
        <span className="block">
          <span className="block font-semibold uppercase tracking-wider text-sky-300 mb-1">
            {s}
          </span>
          {entry ? (
            <>
              <span className="block font-medium text-zinc-100 mb-1">{entry.short}</span>
              <span className="block text-zinc-300">{entry.detail}</span>
            </>
          ) : (
            <span className="block text-zinc-300">
              Estado fora da tabela canônica do systemd. Veja a documentação oficial para esta
              string específica.
            </span>
          )}
        </span>
      }
    >
      <span
        className={`inline-flex items-center text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono cursor-help ${unitFileBadgeClass(state)}`}
      >
        {s}
      </span>
    </InfoTooltip>
  );
}

function ServiceSummary({ entry }: { entry: StationServiceReportEntry }) {
  const info = describeService(entry.unit, entry.description);
  const glossaryEntry = findServiceEntry(entry.unit);
  return (
    <InfoTooltip
      position="top"
      ariaLabel={`o que é ${entry.unit}`}
      content={
        <span className="block">
          <span className="block font-mono font-semibold text-sky-300 mb-1 break-all">
            {entry.unit}
          </span>
          <span className="block font-medium text-zinc-100 mb-1">{info.title}</span>
          <span className="block text-zinc-300">{info.description}</span>
          {glossaryEntry && (
            <span className="block mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
              categoria: {CATEGORY_LABEL[glossaryEntry.category]}
            </span>
          )}
          {entry.fieldsUnknown.length > 0 && (
            <span className="block mt-2 text-[10.5px] text-amber-300/90">
              {entry.fieldsUnknown.length} campo(s) sem valor reportável — systemd não devolveu
              valor legível.
            </span>
          )}
          {entry.error && (
            <span className="block mt-2 text-[10.5px] text-red-300/90">
              systemctl show falhou: {entry.error.code}
              {entry.error.message ? ` — ${entry.error.message}` : ""}
            </span>
          )}
        </span>
      }
    >
      <span className="inline-flex items-center gap-1.5 group cursor-help">
        <span className="truncate font-mono text-[12px] text-zinc-100 group-hover:text-sky-200 transition-colors">
          {entry.unit}
        </span>
        <InfoBadge className="opacity-60 group-hover:opacity-100 transition-opacity" />
      </span>
    </InfoTooltip>
  );
}

function LegendCard() {
  return (
    <DataCard title="Legenda dos estados" eyebrow="systemd reference" defaultOpen={false}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
            activeState — o que a unidade está fazendo agora
          </div>
          <ul className="space-y-1.5">
            {ACTIVE_STATE_GLOSSARY.map((g) => (
              <li key={g.state} className="flex items-start gap-2">
                <StateBadge state={g.state} glossary={ACTIVE_STATE_GLOSSARY} />
                <span className="text-[11.5px] text-zinc-300 leading-snug">
                  <span className="font-medium text-zinc-100">{g.short}.</span> {g.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
            unit-file state — como a unidade está publicada no disco
          </div>
          <ul className="space-y-1.5">
            {UNIT_FILE_STATE_GLOSSARY.map((g) => (
              <li key={g.state} className="flex items-start gap-2">
                <UnitFileBadge state={g.state} />
                <span className="text-[11.5px] text-zinc-300 leading-snug">
                  <span className="font-medium text-zinc-100">{g.short}.</span> {g.detail}
                </span>
              </li>
            ))}
            <li className="flex items-start gap-2">
              <UnitFileBadge state="unknown" />
              <span className="text-[11.5px] text-zinc-300 leading-snug">
                <span className="font-medium text-zinc-100">Estado não reportado.</span> O systemctl
                não devolveu um valor para esta unidade.
              </span>
            </li>
          </ul>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-zinc-700/30 text-[11px] text-zinc-500">
        Passe o mouse (ou toque) em qualquer badge de uma linha de serviço para ver o mesmo
        detalhamento. O badge de cada linha é clicável e abre o mesmo tooltip — útil em telas
        sensíveis ao toque.
      </div>
    </DataCard>
  );
}

function ServiceDetail({ entry }: { entry: StationServiceReportEntry }) {
  const rows: Array<[string, string]> = [];
  rows.push(["Description", entry.description]);
  rows.push(["LoadState", entry.loadState]);
  rows.push(["ActiveState", entry.activeState]);
  rows.push(["SubState", entry.subState ?? "—"]);
  rows.push(["UnitFileState", entry.unitFileState ?? "—"]);
  rows.push(["Preset", entry.preset]);
  rows.push(["Type", entry.type ?? "—"]);
  rows.push(["Restart", entry.restart ?? "—"]);
  rows.push(["MainPID", entry.mainPid == null ? "—" : String(entry.mainPid)]);
  rows.push(["ExecMainPID", entry.execMainPid == null ? "—" : String(entry.execMainPid)]);
  rows.push(["ExecMainStatus", entry.execMainStatus == null ? "—" : String(entry.execMainStatus)]);
  rows.push(["NRestarts", entry.nRestarts == null ? "—" : String(entry.nRestarts)]);
  rows.push(["ActiveEnter", formatTimestamp(entry.activeEnterTimestamp)]);
  rows.push(["ActiveExit", formatTimestamp(entry.activeExitTimestamp)]);
  rows.push(["InactiveEnter", formatTimestamp(entry.inactiveEnterTimestamp)]);
  rows.push(["InactiveExit", formatTimestamp(entry.inactiveExitTimestamp)]);
  rows.push(["Uptime", formatUptime(entry.uptimeSeconds)]);
  rows.push(["MemoryCurrent", formatBytes(entry.memoryCurrentBytes)]);
  rows.push(["CPUUsageNSec", entry.cpuUsageNsec == null ? "—" : String(entry.cpuUsageNsec)]);
  rows.push(["FragmentPath", entry.fragmentPath ?? "—"]);
  rows.push(["SourcePath", entry.sourcePath ?? "—"]);
  rows.push(["Result", entry.result ?? "—"]);
  if (entry.error) {
    rows.push([
      "Error",
      `${entry.error.code}${entry.error.message ? ` — ${entry.error.message}` : ""}${entry.error.stderr ? ` · stderr: ${entry.error.stderr}` : ""}`,
    ]);
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[12px] font-mono pt-2 border-t border-zinc-700/30">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-zinc-500 w-32 shrink-0">{k}</span>
          <span className="text-zinc-200 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function ServiceRow({ entry }: { entry: StationServiceReportEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-zinc-700/30 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 hover:bg-zinc-800/30 transition-colors flex items-center gap-3"
      >
        <span onClick={(e) => e.stopPropagation()}>
          <StateBadge state={entry.activeState} glossary={ACTIVE_STATE_GLOSSARY} />
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <UnitFileBadge state={entry.unitFileState} />
        </span>
        <span className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <ServiceSummary entry={entry} />
        </span>
        <span className="hidden md:inline truncate text-[11px] text-zinc-400 max-w-[260px]">
          {entry.description}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">
          {formatUptime(entry.uptimeSeconds)}
        </span>
        <span aria-hidden className="text-zinc-500 text-xs">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 bg-zinc-900/30">
          <ServiceDetail entry={entry} />
        </div>
      )}
    </div>
  );
}

function SummaryBadges({ report }: { report: StationServicesReport }) {
  const items: Array<{ key: string; label: string; tone: string }> = [];
  items.push({
    key: "total",
    label: `${report.count} serviços`,
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  });
  items.push({
    key: "active",
    label: `active ${report.summary.byActiveState.active ?? 0}`,
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  });
  items.push({
    key: "inactive",
    label: `inactive ${report.summary.byActiveState.inactive ?? 0}`,
    tone: "border-zinc-500/30 bg-zinc-700/30 text-zinc-300",
  });
  items.push({
    key: "failed",
    label: `failed ${report.summary.byActiveState.failed ?? report.summary.failed ?? 0}`,
    tone: "border-red-500/30 bg-red-500/10 text-red-300",
  });
  items.push({
    key: "enabled",
    label: `enabled ${report.summary.enabledDisabled.enabled}`,
    tone: "border-emerald-700/30 bg-emerald-700/10 text-emerald-200",
  });
  items.push({
    key: "disabled",
    label: `disabled ${report.summary.enabledDisabled.disabled}`,
    tone: "border-zinc-600/30 bg-zinc-700/20 text-zinc-300",
  });
  items.push({
    key: "static",
    label: `static ${report.summary.byUnitFileState.static ?? 0}`,
    tone: "border-sky-700/30 bg-sky-800/20 text-sky-200",
  });
  items.push({
    key: "masked",
    label: `masked ${report.summary.byUnitFileState.masked ?? 0}`,
    tone: "border-red-900/40 bg-red-950/30 text-red-300",
  });
  return (
    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
      {items.map((it) => (
        <span
          key={it.key}
          className={`inline-flex items-center px-2.5 py-1 rounded border ${it.tone}`}
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ServicosInventarioKaos() {
  const reportState = useApi(() => hestiaApi.stationServicesReport("kaos"), []);
  const connectionState = useApi(() => hestiaApi.stationConnection("kaos"), []);
  const bindings = useApi(hestiaApi.serviceBindings);

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [unitFileFilter, setUnitFileFilter] = useState<UnitFileFilter>("all");
  const [search, setSearch] = useState("");

  const report = reportState.state.status === "ok" ? reportState.state.data : null;

  const filtered = useMemo(() => {
    if (!report) return [];
    const term = search.trim().toLowerCase();
    return report.services.filter((s) => {
      if (activeFilter !== "all" && s.activeState !== activeFilter) return false;
      if (unitFileFilter !== "all" && (s.unitFileState ?? "unknown") !== unitFileFilter)
        return false;
      if (term) {
        const hay = `${s.unit} ${s.description}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [report, activeFilter, unitFileFilter, search]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="kaline-eyebrow">Héstia → KAOS · inventário systemctl</p>
          <h1 className="kaline-serif text-3xl text-[color:var(--kaline-text)]">
            Inventário completo de serviços da KAOS
          </h1>
          <p className="text-[13px] text-[color:var(--kaline-muted)] mt-1">
            Enumeração dinâmica via <code className="font-mono">systemctl list-unit-files</code> +{" "}
            <code className="font-mono">systemctl show</code> na própria estação KAOS — sem
            whitelist, sem filtro, sem mock.
          </p>
        </div>
        <Link
          to="/"
          className="text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200 border border-zinc-700/40 rounded px-3 py-1.5"
        >
          ← voltar ao Painel
        </Link>
      </header>

      <DataCard
        title="Conexão com a KAOS"
        eyebrow="Station Agent"
        status={
          connectionState.state.status === "ok"
            ? connectionState.state.data.state === "available"
              ? "ok"
              : "warn"
            : connectionState.state.status === "loading"
              ? "loading"
              : "unavailable"
        }
      >
        {connectionState.state.status === "ok" ? (
          <div className="text-[12px] font-mono text-zinc-300">
            {connectionState.state.data.station?.service ?? "—"} v
            {connectionState.state.data.station?.version ?? "—"} · latência{" "}
            {connectionState.state.data.latencyMs ?? "—"} ms
          </div>
        ) : connectionState.state.status === "loading" ? (
          <div className="text-[12px] text-zinc-500 font-mono">consultando conexão…</div>
        ) : connectionState.state.status === "unavailable" ? (
          <UnavailableNote
            message={connectionState.state.message}
            details={connectionState.state.details}
            onRetry={connectionState.retry}
            refreshing={connectionState.refreshing}
          />
        ) : (
          <div className="text-[12px] text-zinc-500 font-mono">sem conexão ativa</div>
        )}
      </DataCard>

      <DataCard
        title="Estatísticas agregadas"
        eyebrow="systemd inventory"
        status={
          reportState.state.status === "ok"
            ? "ok"
            : reportState.state.status === "loading"
              ? "loading"
              : "unavailable"
        }
        defaultOpen
      >
        {reportState.state.status === "ok" && report ? (
          <div className="space-y-4">
            <SummaryBadges report={report} />
            <div className="text-[11px] text-zinc-500 font-mono">
              gerado em {formatTimestamp(report.generatedAt)} · fonte: KAOS Station Agent
            </div>
          </div>
        ) : reportState.state.status === "loading" ? (
          <div className="text-[12px] text-zinc-500 font-mono">consultando systemd da KAOS…</div>
        ) : reportState.state.status === "unavailable" ? (
          <UnavailableNote
            message={reportState.state.message}
            details={reportState.state.details}
            onRetry={reportState.retry}
            refreshing={reportState.refreshing}
          />
        ) : (
          <div className="text-[12px] text-zinc-500 font-mono">aguardando primeira consulta…</div>
        )}
      </DataCard>

      <DataCard
        title={`Inventário completo${report ? ` · mostrando ${filtered.length} de ${report.count}` : ""}`}
        eyebrow="*.service"
        status={reportState.state.status === "ok" ? "ok" : "loading"}
        defaultOpen
      >
        {reportState.state.status === "ok" && report ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="buscar por nome ou descrição…"
                className="flex-1 min-w-[220px] bg-zinc-900/60 border border-zinc-700/40 rounded px-3 py-1.5 text-[12px] font-mono text-zinc-200 placeholder:text-zinc-500"
              />
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
                className="bg-zinc-900/60 border border-zinc-700/40 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200"
              >
                <option value="all">active: todos</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="failed">failed</option>
                <option value="activating">activating</option>
                <option value="deactivating">deactivating</option>
                <option value="reloading">reloading</option>
                <option value="maintenance">maintenance</option>
                <option value="unknown">unknown</option>
              </select>
              <select
                value={unitFileFilter}
                onChange={(e) => setUnitFileFilter(e.target.value as UnitFileFilter)}
                className="bg-zinc-900/60 border border-zinc-700/40 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200"
              >
                <option value="all">unit-file: todos</option>
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
                <option value="static">static</option>
                <option value="masked">masked</option>
                <option value="generated">generated</option>
                <option value="transient">transient</option>
                <option value="bad">bad</option>
                <option value="indirect">indirect</option>
                <option value="unknown">unknown</option>
              </select>
              <button
                type="button"
                onClick={() => reportState.retry()}
                disabled={reportState.refreshing}
                className="text-[11px] font-mono border border-zinc-700/40 rounded px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800/30 disabled:opacity-60"
              >
                {reportState.refreshing ? "atualizando…" : "reconsultar systemd"}
              </button>
            </div>

            {filtered.length === 0 ? (
              <div className="text-[12px] text-zinc-500 font-mono py-2">
                Nenhum serviço corresponde aos filtros.
              </div>
            ) : (
              <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
                {filtered.map((svc) => (
                  <ServiceRow key={svc.unit} entry={svc} />
                ))}
              </div>
            )}
          </div>
        ) : reportState.state.status === "loading" ? (
          <div className="text-[12px] text-zinc-500 font-mono">carregando inventário…</div>
        ) : reportState.state.status === "idle" ? (
          <div className="text-[12px] text-zinc-500 font-mono">aguardando consulta…</div>
        ) : reportState.state.status === "unavailable" ? (
          <UnavailableNote
            message={reportState.state.message}
            details={reportState.state.details}
            onRetry={reportState.retry}
            refreshing={reportState.refreshing}
          />
        ) : null}
      </DataCard>

      <DataCard
        title="Vínculos"
        eyebrow="serviços"
        status={bindings.state.status === "ok" ? "ok" : "idle"}
      >
        {bindings.state.status === "ok" &&
          bindings.state.data.map((x) => (
            <Row key={x.id} k={x.label} v={`${x.serviceName} · ${x.role}`} />
          ))}
      </DataCard>

      <LegendCard />
    </div>
  );
}
