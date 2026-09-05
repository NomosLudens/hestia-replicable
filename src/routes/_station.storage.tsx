import { createFileRoute } from "@tanstack/react-router";
import { hestiaLegacyApi, formatBytes } from "@/lib/hestia/api";
import { useApi } from "@/lib/hestia/useApi";
import { UnavailableNote } from "@/components/hestia/shared/UnavailableNote";
import { DataCard, type CardStatus } from "@/components/hestia/shared/DataCard";
import { Row } from "@/components/hestia/shared/Row";

function statusOf(s: { status: string }): CardStatus {
  if (s.status === "loading") return "loading";
  if (s.status === "unavailable") return "error";
  return "ok";
}

export const Route = createFileRoute("/_station/storage")({
  head: () => ({
    meta: [
      { title: "Héstia Console — Storage" },
      {
        name: "description",
        content: "Volumes, caminhos, fontes externas, estado do /KALINE e scan read-only.",
      },
      { property: "og:title", content: "Héstia Console — Storage" },
      {
        property: "og:description",
        content: "Leitura de armazenamento local: volumes, fontes e /KALINE.",
      },
    ],
  }),
  component: StoragePage,
});

export function StoragePage() {
  const storage = useApi(hestiaLegacyApi.storage);
  const model = useApi(hestiaLegacyApi.storageModel);
  const sources = useApi(hestiaLegacyApi.storageSources);
  const scan = useApi(hestiaLegacyApi.storageScan);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="kaline-eyebrow">/storage</p>
        <h1 className="kaline-serif text-3xl md:text-4xl text-[color:var(--kaline-text)]">
          Storage da Héstia Console
        </h1>
        <p className="mt-2 text-[13px] text-[color:var(--kaline-muted)] max-w-2xl">
          Volumes, caminhos, fontes externas e estado do /KALINE. Esta rota é somente leitura.
        </p>
      </header>

      <section className="grid gap-5 md:grid-cols-2">
        <DataCard eyebrow="Volumes" title="Caminhos monitorados" status={statusOf(storage.state)}>
          {storage.state.status === "loading" && <p>consultando…</p>}
          {storage.state.status === "unavailable" && (
            <UnavailableNote
              message={storage.state.message}
              details={storage.state.details}
              onRetry={storage.retry}
              refreshing={storage.refreshing}
            />
          )}
          {storage.state.status === "ok" &&
            storage.state.data.items.map((item) => (
              <Row
                key={item.path}
                k={item.path}
                v={
                  item.exists && item.total != null
                    ? `${formatBytes(item.used ?? 0)} / ${formatBytes(item.total)} · ${item.percentUsed ?? "?"}%`
                    : (item.error ?? item.status)
                }
              />
            ))}
        </DataCard>

        <DataCard
          eyebrow="Modelo"
          title="Árvore canônica /KALINE"
          status={statusOf(model.state)}
          summary={model.state.status === "ok" ? model.state.data.root : undefined}
        >
          {model.state.status === "loading" && <p>consultando…</p>}
          {model.state.status === "unavailable" && (
            <UnavailableNote
              message={model.state.message}
              details={model.state.details}
              onRetry={model.retry}
              refreshing={model.refreshing}
            />
          )}
          {model.state.status === "ok" &&
            model.state.data.folders.map((f) => (
              <div
                key={f.id}
                className="border-b border-[color:var(--kaline-border-copper)]/40 pb-2 last:border-0"
              >
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-mono text-[13px] text-[color:var(--kaline-text)]">
                    {f.relativePath}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)]">
                    {f.category}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--kaline-faint)]">{f.purpose}</div>
              </div>
            ))}
        </DataCard>

        <DataCard eyebrow="Fontes" title="Fontes externas" status={statusOf(sources.state)}>
          {sources.state.status === "loading" && <p>consultando…</p>}
          {sources.state.status === "unavailable" && (
            <UnavailableNote
              message={sources.state.message}
              details={sources.state.details}
              onRetry={sources.retry}
              refreshing={sources.refreshing}
            />
          )}
          {sources.state.status === "ok" && sources.state.data.items.length === 0 && (
            <p className="text-[color:var(--kaline-faint)] text-[13px]">Nenhuma fonte externa.</p>
          )}
          {sources.state.status === "ok" &&
            sources.state.data.items.map((s) => (
              <Row key={s.id} k={s.label} v={`${s.path} · ${s.mode}`} />
            ))}
        </DataCard>

        <DataCard
          eyebrow="Scan"
          title="Resumo de /KALINE e fontes externas"
          status={statusOf(scan.state)}
        >
          {scan.state.status === "loading" && <p>consultando…</p>}
          {scan.state.status === "unavailable" && (
            <UnavailableNote
              message={scan.state.message}
              details={scan.state.details}
              onRetry={scan.retry}
              refreshing={scan.refreshing}
            />
          )}
          {scan.state.status === "ok" && (
            <>
              {scan.state.data.kaline.folders
                .filter((f) => f.exists && f.files > 0)
                .map((f) => (
                  <Row
                    key={f.id}
                    k={f.path ?? f.id}
                    v={`${f.files} arquivos · ${formatBytes(f.bytes)}`}
                  />
                ))}
              {scan.state.data.sources.items.map((s) => (
                <Row key={s.id} k={s.label} v={`${s.files} arquivos · ${formatBytes(s.bytes)}`} />
              ))}
            </>
          )}
        </DataCard>
      </section>
    </div>
  );
}
