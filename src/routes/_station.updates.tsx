import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  hestiaApi,
  STATION_IDS,
  type ApplicationItem,
  type StationAppsResult,
  type StationId,
  type StationUpdates,
  type UpdatePackageItem,
} from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { DataCard } from "@/components/hestia/shared/DataCard";
import { Row } from "@/components/hestia/shared/Row";

const MANAGEABLE_STATION_IDS = STATION_IDS.filter((id) => id !== "kaos");

export const Route = createFileRoute("/_station/updates")({ component: UpdatesDoDia });

const STATION_NAMES: Record<string, string> = {
  desktop: "Servidor",
  tvbox: "TV Box",
  pocket: "Pocket",
  baby: "Baby",
  mini: "Mini",
  max: "MAX",
  note: "Notebook",
};

type SelectedSystemPackagesModal = {
  stationName: string;
  updates: UpdatePackageItem[];
} | null;

type AuthorizeUpdateModalState = {
  stationId: StationId;
  stationName: string;
  app: ApplicationItem;
} | null;

export function UpdatesDoDia() {
  const [systemModal, setSystemModal] = useState<SelectedSystemPackagesModal>(null);
  const [authorizeModal, setAuthorizeModal] = useState<AuthorizeUpdateModalState>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [updateExecuting, setUpdateExecuting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleCloseAuthorizeModal = () => {
    setPasswordInput("");
    setAuthError(null);
    setUpdateExecuting(false);
    setAuthorizeModal(null);
  };

  const handleAuthorizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorizeModal) return;

    const secret = passwordInput.trim();
    // Limpar o input no React imediatamente após disparar
    setPasswordInput("");
    setAuthError(null);
    setUpdateExecuting(true);

    try {
      const res = await hestiaApi.updateStationApp(
        authorizeModal.stationId,
        authorizeModal.app.id,
        secret,
      );

      if (res.status === "ok") {
        if (res.data.ok === true) {
          handleCloseAuthorizeModal();
          setRefreshTrigger((prev) => prev + 1);
        } else {
          const errorMsg =
            res.data.code === "AUTHORIZATION_FAILED"
              ? "Senha sudo incorreta ou autorização negada."
              : res.data.error || "Falha ao executar a atualização.";
          setAuthError(errorMsg);
          setUpdateExecuting(false);
        }
      } else if (res.status === "unavailable") {
        setAuthError(res.message || "Erro de comunicação ao enviar autorização.");
        setUpdateExecuting(false);
      } else {
        setAuthError("Estado inesperado ao enviar autorização.");
        setUpdateExecuting(false);
      }
    } catch {
      setAuthError("Erro de comunicação ao enviar autorização.");
      setUpdateExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="kaline-eyebrow">/updates</p>
          <h1 className="kaline-serif text-3xl text-[color:var(--kaline-text)]">Updates do Dia</h1>
          <p className="mt-1 text-xs text-[color:var(--kaline-muted)]">
            Inventário de pacotes do sistema e aplicativos instalados por Station
          </p>
        </div>
      </header>

      <UpdatesSummary refreshTrigger={refreshTrigger} />

      <section className="space-y-4">
        <h2 className="serif text-xl text-[color:var(--kaline-text)]">Máquinas Registradas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(STATION_IDS as StationId[]).map((id) => (
            <StationUpdateCard
              key={id}
              stationId={id}
              refreshTrigger={refreshTrigger}
              onInspectSystemPackages={(updates) =>
                setSystemModal({ stationName: STATION_NAMES[id] || id, updates })
              }
              onStartUpdateApp={(app) =>
                setAuthorizeModal({
                  stationId: id,
                  stationName: STATION_NAMES[id] || id,
                  app,
                })
              }
            />
          ))}
        </div>
      </section>

      {/* Modal de Detalhes dos Pacotes de Sistema */}
      {systemModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="system-packages-modal-title"
        >
          <div className="bg-[#121212] border border-[color:var(--kaline-border-copper)] rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-[color:var(--kaline-border-copper)] flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
                  Pacotes do Sistema (APT)
                </p>
                <h3
                  id="system-packages-modal-title"
                  className="serif text-xl text-[color:var(--kaline-text)]"
                >
                  {systemModal.stationName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSystemModal(null)}
                className="px-3 py-1.5 rounded text-xs bg-white/5 hover:bg-white/10 text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-text)] border border-white/10"
              >
                Fechar
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-3 flex-1">
              {systemModal.updates.length === 0 ? (
                <p className="text-sm text-[color:var(--kaline-muted)] italic">
                  Nenhuma atualização pendente nesta máquina.
                </p>
              ) : (
                <div className="space-y-2">
                  {systemModal.updates.map((pkg) => (
                    <div
                      key={pkg.package}
                      className="p-3 rounded border border-white/5 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-[color:var(--kaline-text)]">
                            {pkg.package}
                          </span>
                          {pkg.security === true ? (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              Segurança
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium bg-white/5 text-[color:var(--kaline-faint)] border border-white/10">
                              Sistema
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[color:var(--kaline-muted)] mt-1 font-mono">
                          {pkg.installedVersion} →{" "}
                          <span className="text-[color:var(--kaline-ember)]">
                            {pkg.candidateVersion}
                          </span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[color:var(--kaline-border-copper)] flex justify-end">
              <button
                type="button"
                onClick={() => setSystemModal(null)}
                className="px-4 py-2 rounded text-xs uppercase tracking-wider font-medium bg-[color:var(--kaline-copper)]/20 hover:bg-[color:var(--kaline-copper)]/30 text-[color:var(--kaline-text)] border border-[color:var(--kaline-copper)]/40"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Autorização de Atualização de Aplicativo com Senha Efêmera */}
      {authorizeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="authorize-modal-title"
        >
          <div className="bg-[#121212] border border-[color:var(--kaline-border-copper)] rounded-lg w-full max-w-md flex flex-col shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-[color:var(--kaline-border-copper)]">
              <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
                Autorizar atualização
              </p>
              <h3
                id="authorize-modal-title"
                className="serif text-xl text-[color:var(--kaline-text)]"
              >
                {authorizeModal.app.name}
              </h3>
            </div>

            <form onSubmit={handleAuthorizeSubmit} className="p-4 sm:p-6 space-y-4">
              <div className="p-3 rounded border border-white/5 bg-white/[0.02] space-y-2 text-xs font-mono">
                <Row k="Station" v={authorizeModal.stationName} />
                <Row k="Origem" v={authorizeModal.app.source.toUpperCase()} />
                <Row k="Versão instalada" v={authorizeModal.app.installedVersion || "—"} />
                <Row k="Versão disponível" v={authorizeModal.app.availableVersion || "—"} />
                <Row k="Ação" v={`Atualizar somente ${authorizeModal.app.name}`} />
              </div>

              {authError && (
                <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-mono">
                  {authError}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="sudo-password"
                  className="block text-xs font-medium text-[color:var(--kaline-text)]"
                >
                  Senha sudo desta Station:
                </label>
                <input
                  id="sudo-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••••••"
                  autoFocus
                  disabled={updateExecuting}
                  className="w-full px-3 py-2 rounded bg-black/60 border border-white/15 text-sm text-[color:var(--kaline-text)] placeholder-[color:var(--kaline-faint)] focus:outline-none focus:border-[color:var(--kaline-copper)] font-mono"
                />
              </div>

              <p className="text-[11px] text-[color:var(--kaline-faint)] italic">
                ☑ A senha será usada apenas nesta operação e não será armazenada.
              </p>

              <div className="pt-2 flex justify-end gap-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={handleCloseAuthorizeModal}
                  disabled={updateExecuting}
                  className="px-3 py-1.5 rounded text-xs bg-white/5 hover:bg-white/10 text-[color:var(--kaline-muted)] border border-white/10 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updateExecuting}
                  className="px-4 py-1.5 rounded text-xs font-medium uppercase tracking-wider bg-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper-hover)] text-white disabled:opacity-50 transition-colors"
                >
                  {updateExecuting ? "Atualizando..." : "Autorizar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function UpdatesSummary({ refreshTrigger }: { refreshTrigger: number }) {
  const desktopUpdates = useApi(() => hestiaApi.stationUpdates("desktop"), [refreshTrigger]);
  const tvboxUpdates = useApi(() => hestiaApi.stationUpdates("tvbox"), [refreshTrigger]);
  const pocketUpdates = useApi(() => hestiaApi.stationUpdates("pocket"), [refreshTrigger]);
  const babyUpdates = useApi(() => hestiaApi.stationUpdates("baby"), [refreshTrigger]);
  const miniUpdates = useApi(() => hestiaApi.stationUpdates("mini"), [refreshTrigger]);
  const maxUpdates = useApi(() => hestiaApi.stationUpdates("max"), [refreshTrigger]);
  const noteUpdates = useApi(() => hestiaApi.stationUpdates("note"), [refreshTrigger]);

  const desktopApps = useApi(() => hestiaApi.stationApps("desktop"), [refreshTrigger]);
  const tvboxApps = useApi(() => hestiaApi.stationApps("tvbox"), [refreshTrigger]);
  const pocketApps = useApi(() => hestiaApi.stationApps("pocket"), [refreshTrigger]);
  const babyApps = useApi(() => hestiaApi.stationApps("baby"), [refreshTrigger]);
  const miniApps = useApi(() => hestiaApi.stationApps("mini"), [refreshTrigger]);
  const maxApps = useApi(() => hestiaApi.stationApps("max"), [refreshTrigger]);
  const noteApps = useApi(() => hestiaApi.stationApps("note"), [refreshTrigger]);

  const allUpdatesState = [
    desktopUpdates.state,
    tvboxUpdates.state,
    pocketUpdates.state,
    babyUpdates.state,
    miniUpdates.state,
    maxUpdates.state,
    noteUpdates.state,
  ];

  const allAppsState = [
    desktopApps.state,
    tvboxApps.state,
    pocketApps.state,
    babyApps.state,
    miniApps.state,
    maxApps.state,
    noteApps.state,
  ];

  let totalSystemUpdates = 0;
  let totalSecurityCount = 0;

  for (const st of allUpdatesState) {
    if (st.status === "ok" && st.data.ok === true) {
      totalSystemUpdates += st.data.totalUpdates;
      totalSecurityCount += st.data.securityUpdates || 0;
    }
  }

  let totalAppsInstalled = 0;
  let totalAppsUpdateAvailable = 0;

  for (const st of allAppsState) {
    if (st.status === "ok" && st.data.ok === true && st.data.summary) {
      totalAppsInstalled += st.data.summary.totalInstalled || 0;
      totalAppsUpdateAvailable += st.data.summary.updateAvailable || 0;
    }
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="p-4 rounded border border-[color:var(--kaline-border-copper)] bg-[#121212]">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
          Pacotes Sistema
        </p>
        <p className="mt-2 text-2xl font-mono font-semibold text-[color:var(--kaline-ember)]">
          {totalSystemUpdates}
        </p>
        <p className="mt-1 text-[10px] text-[color:var(--kaline-faint)]">
          {totalSecurityCount} de segurança confirmadas
        </p>
      </div>

      <div className="p-4 rounded border border-[color:var(--kaline-border-copper)] bg-[#121212]">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
          Aplicativos Detectados
        </p>
        <p className="mt-2 text-2xl font-mono font-semibold text-emerald-400">
          {totalAppsInstalled}
        </p>
        <p className="mt-1 text-[10px] text-[color:var(--kaline-faint)]">
          {totalAppsUpdateAvailable} atualizações de app disponíveis
        </p>
      </div>

      <div className="p-4 rounded border border-[color:var(--kaline-border-copper)] bg-[#121212]">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
          Guardião Héstia
        </p>
        <p className="mt-2 text-xs font-mono text-emerald-400 font-medium uppercase">
          Ação Controlada
        </p>
        <p className="mt-1 text-[10px] text-[color:var(--kaline-faint)]">
          Senha efêmera por operação
        </p>
      </div>

      <div className="p-4 rounded border border-[color:var(--kaline-border-copper)] bg-[#121212]">
        <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
          Status de Rede
        </p>
        <p className="mt-2 text-xs font-mono text-[color:var(--kaline-muted)]">
          {MANAGEABLE_STATION_IDS.length} Stations gerenciáveis
        </p>
      </div>
    </div>
  );
}

function StationUpdateCard({
  stationId,
  refreshTrigger,
  onInspectSystemPackages,
  onStartUpdateApp,
}: {
  stationId: StationId;
  refreshTrigger: number;
  onInspectSystemPackages: (updates: UpdatePackageItem[]) => void;
  onStartUpdateApp: (app: ApplicationItem) => void;
}) {
  const [showAppsList, setShowAppsList] = useState(false);
  const name = STATION_NAMES[stationId] || stationId;
  const conn = useApi(() => hestiaApi.stationConnection(stationId), [refreshTrigger]);
  const sys = useApi(() => hestiaApi.stationSystem(stationId), [refreshTrigger]);
  const upd = useApi(() => hestiaApi.stationUpdates(stationId), [refreshTrigger]);
  const apps = useApi(() => hestiaApi.stationApps(stationId), [refreshTrigger]);

  const isOnline = conn.state.status === "ok" && conn.state.data.state === "available";
  const isNotConfigured = conn.state.status === "ok" && conn.state.data.state === "not_configured";
  const isOffline =
    conn.state.status === "unavailable" ||
    (conn.state.status === "ok" && conn.state.data.state === "unavailable");

  const updatesData: StationUpdates | null = upd.state.status === "ok" ? upd.state.data : null;
  const appsData: StationAppsResult | null = apps.state.status === "ok" ? apps.state.data : null;

  const isOkUpdates = updatesData?.ok === true && updatesData?.status === "ok";
  const isOkApps = appsData?.ok === true && appsData?.status === "ok";

  const handleRefresh = () => {
    conn.retry();
    sys.retry();
    upd.retry();
    apps.retry();
  };

  return (
    <DataCard
      title={name}
      eyebrow={stationId}
      status={isOnline ? "ok" : isNotConfigured ? "idle" : "error"}
      defaultOpen
    >
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center justify-between pb-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            {isOnline && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                ONLINE
              </span>
            )}
            {isOffline && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30">
                OFFLINE
              </span>
            )}
            {isNotConfigured && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-white/5 text-[color:var(--kaline-faint)] border border-white/10">
                NÃO CONFIGURADO
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-[color:var(--kaline-faint)]">
            {conn.state.status === "ok"
              ? new Date(conn.state.data.checkedAt).toLocaleTimeString()
              : "—"}
          </span>
        </div>

        {/* BLOCO 1: SISTEMA */}
        <div className="p-3 rounded border border-white/5 bg-white/[0.01] space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--kaline-copper)]">
            SISTEMA
          </p>

          {isOkUpdates ? (
            <div className="space-y-1">
              <Row
                k="Atualizações"
                v={`${updatesData.totalUpdates} ${
                  updatesData.securityUpdates ? `(${updatesData.securityUpdates} de segurança)` : ""
                }`}
              />
              {updatesData.rebootRequired && (
                <div className="p-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
                  REINICIALIZAÇÃO NECESSÁRIA
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[color:var(--kaline-faint)] italic">
              {updatesData?.ok === false ? `Status: ${updatesData.reason}` : "Indisponível"}
            </p>
          )}

          {isOkUpdates && updatesData.updates.length > 0 && (
            <button
              type="button"
              onClick={() => onInspectSystemPackages(updatesData.updates)}
              className="mt-1 text-[11px] font-medium text-[color:var(--kaline-copper)] hover:underline"
            >
              [ Ver pacotes do sistema ({updatesData.updates.length}) ]
            </button>
          )}
        </div>

        {/* BLOCO 2: APLICATIVOS */}
        <div className="p-3 rounded border border-white/5 bg-white/[0.01] space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            APLICATIVOS
          </p>

          {isOkApps ? (
            <div className="space-y-1">
              <Row
                k="Detectados"
                v={`${appsData.summary.totalInstalled} (${appsData.summary.upToDate} atualizados, ${appsData.summary.updateAvailable} com atualização)`}
              />
            </div>
          ) : (
            <p className="text-xs text-[color:var(--kaline-faint)] italic">
              {appsData?.ok === false ? `Status: ${appsData.reason}` : "Sem inventário ativo"}
            </p>
          )}

          {isOkApps && appsData.applications.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAppsList(!showAppsList)}
                className="mt-1 text-[11px] font-medium text-emerald-400 hover:underline"
              >
                [{" "}
                {showAppsList
                  ? "Ocultar aplicativos"
                  : `Ver aplicativos (${appsData.applications.length})`}{" "}
                ]
              </button>

              {showAppsList && (
                <div className="mt-3 space-y-2 pt-2 border-t border-white/5">
                  {appsData.applications.map((app) => (
                    <div
                      key={app.id}
                      className="p-2.5 rounded border border-white/5 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs font-mono"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-sans font-medium text-sm text-[color:var(--kaline-text)]">
                            {app.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-white/5 text-[color:var(--kaline-faint)] border border-white/10">
                            {app.source}
                          </span>
                          {app.updateStatus === "update_available" ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              Atualização disponível
                            </span>
                          ) : app.updateStatus === "up_to_date" ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Atualizado
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-medium bg-white/5 text-[color:var(--kaline-faint)]">
                              Sem verificação
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[color:var(--kaline-muted)] mt-1">
                          Instalada: {app.installedVersion || "—"}
                          {app.availableVersion &&
                            app.availableVersion !== app.installedVersion && (
                              <span>
                                {" "}
                                → Disponível:{" "}
                                <span className="text-amber-400">{app.availableVersion}</span>
                              </span>
                            )}
                        </p>
                      </div>

                      {app.updateStatus === "update_available" &&
                        app.updateCapability === "controlled" && (
                          <button
                            type="button"
                            onClick={() => onStartUpdateApp(app)}
                            className="px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper-hover)] text-white shadow-sm transition-colors self-start sm:self-center"
                          >
                            Atualizar
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={upd.refreshing || apps.refreshing}
            className="px-3 py-1.5 rounded text-xs bg-white/5 hover:bg-white/10 text-[color:var(--kaline-text)] border border-white/10 disabled:opacity-50 transition-colors"
          >
            {upd.refreshing || apps.refreshing ? "Consultando..." : "Consultar"}
          </button>
        </div>
      </div>
    </DataCard>
  );
}
