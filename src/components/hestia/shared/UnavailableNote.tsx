import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HESTIA } from "@/content/kaline";
import type { ApiErrorDetails } from "@/lib/hestia/api";

/**
 * Serialização estável para clipboard: pretty print (2 espaços) + chaves
 * ordenadas alfabeticamente em qualquer profundidade. Garante que dois
 * erros idênticos produzam bytes idênticos, facilitando diff e busca.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortedReplacer(), 2);
}

function sortedReplacer() {
  const seen = new WeakSet<object>();
  return function (_key: string, val: unknown) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      if (seen.has(val as object)) return "[Circular]";
      seen.add(val as object);
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  };
}

export function formatJson(value: unknown, compact: boolean): string {
  return compact ? JSON.stringify(value, sortedReplacer()) : stableStringify(value);
}

async function copyErrorJson(payload: unknown) {
  const text = stableStringify(payload);
  await copyToClipboard(text, "JSON copiado", `${text.length} caracteres · chaves ordenadas`);
}

function downloadErrorJson(payload: unknown, details: ApiErrorDetails) {
  const text = stableStringify(payload);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildDownloadFilename(details);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("JSON baixado", {
    description: `${text.length} caracteres · ${a.download}`,
  });
}

export function buildDownloadFilename(details: ApiErrorDetails): string {
  const stamp = formatStamp(details.at);
  const slug = sanitizeRouteSlug(details.route);
  const type = errorTypeSegment(details);
  return `hestia-${slug}-${type}-${stamp}.json`;
}

function errorTypeSegment(details: ApiErrorDetails): string {
  switch (details.origin) {
    case "http": {
      const code = details.code || details.httpStatus?.toString() || "error";
      return `http_${code}`;
    }
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "no-base":
      return "no_base";
    default:
      return "error";
  }
}

function formatStamp(raw?: string): string {
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    }
  }
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sanitizeRouteSlug(route?: string): string {
  const base = route ? route.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]/g, "_") : "error";
  const slug = base
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return slug || "error";
}

function buildPayload(message: string | undefined, details: ApiErrorDetails) {
  return { message: message ?? null, ...details };
}

export function buildReadableDetails(
  message: string | undefined,
  details: ApiErrorDetails,
): string {
  const lines = [
    `Héstia Console — detalhes do erro`,
    ``,
    `status: ${details.origin}`,
    `rota: ${details.route ?? "—"}`,
    `http: ${details.httpStatus?.toString() ?? "—"}`,
    `code: ${details.code ?? "—"}`,
    `error: ${details.error ?? "—"}`,
    `hint: ${details.hint ?? "—"}`,
    `at: ${details.at ?? "—"}`,
    `timeout: ${details.timeoutMs != null ? `${details.timeoutMs}ms` : "—"}`,
    ``,
    `mensagem: ${message ?? "—"}`,
  ];
  return lines.join("\n");
}

async function copyToClipboard(text: string, successTitle: string, successDescription: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success(successTitle, { description: successDescription });
  } catch (err) {
    toast.error("Não foi possível copiar", {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

async function copyReadableDetails(message: string | undefined, details: ApiErrorDetails) {
  const text = buildReadableDetails(message, details);
  await copyToClipboard(
    text,
    "Detalhes copiados",
    `${text.length} caracteres · status, rota, code, error, hint, at`,
  );
}

const ORIGIN_LABEL: Record<ApiErrorDetails["origin"], string> = {
  "no-base": "Sem host local",
  network: "Falha de rede",
  timeout: "Tempo esgotado",
  http: "Resposta HTTP de erro",
};

function humanSummary(details?: ApiErrorDetails): string {
  if (!details) return "Sem detalhes estruturados disponíveis.";
  switch (details.origin) {
    case "no-base":
      return "O frontend não está em host local, então nenhuma requisição foi enviada. Rode a Chama Local e acesse pelo navegador em http://localhost:4517.";
    case "timeout":
      return `A rota ${details.route ?? "desconhecida"} não respondeu em ${details.timeoutMs ?? "?"}ms. O processo pode estar travado ou o host sobrecarregado.`;
    case "network":
      return `A requisição para ${details.route ?? "a Chama Local"} falhou antes de receber resposta: ${details.detail ?? "erro de rede"}. Provavelmente o processo hestia.js não está ativo, ou a porta 4517 está bloqueada.`;
    case "http": {
      const code = details.code ? ` (${details.code})` : "";
      return `A Chama Local respondeu com HTTP ${details.httpStatus}${code}. ${details.detail ?? "Sem mensagem adicional."} ${details.hint ?? ""}`.trim();
    }
  }
}

export function UnavailableNote({
  message,
  details,
  onRetry,
  refreshing,
}: {
  message?: string;
  details?: ApiErrorDetails;
  onRetry?: () => void;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const showInline = details?.origin === "http";
  const payload = details ? buildPayload(message, details) : null;
  const toggleCompact = () => setCompact((c) => !c);

  return (
    <div className="rounded-lg border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-glass)] p-4 text-[13px] text-[color:var(--kaline-muted)]">
      <p className="kaline-eyebrow text-[color:var(--kaline-amber)]">
        {showInline
          ? `HTTP ${details.httpStatus ?? "?"} · ${ORIGIN_LABEL[details.origin]}`
          : HESTIA.waiting}
      </p>
      <p className="mt-2">{message ?? "API local indisponível"}</p>

      {showInline && (
        <dl className="mt-3 grid grid-cols-[70px_1fr] gap-y-1 gap-x-3 font-mono text-[12px] border-t border-[color:var(--kaline-border-copper)]/50 pt-3">
          <InlineField label="error" value={details.error} />
          <InlineField label="code" value={details.code} />
          <InlineField label="detail" value={details.detail} />
          <InlineField label="route" value={details.route} />
          <InlineField label="hint" value={details.hint} />
          <InlineField label="at" value={details.at} />
        </dl>
      )}

      {!showInline && (
        <p className="mt-1 text-[color:var(--kaline-faint)] text-[12px]">
          Sem leitura real ainda · Nenhuma métrica será inventada
        </p>
      )}

      {payload && (
        <div className="mt-3 border-t border-[color:var(--kaline-border-copper)]/50 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="kaline-eyebrow text-[color:var(--kaline-faint)]">Payload JSON</p>
            <button
              type="button"
              onClick={toggleCompact}
              className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
              aria-label={compact ? "Expandir JSON" : "Compactar JSON"}
            >
              {compact ? "pretty print" : "compacto"}
            </button>
          </div>
          <JsonPreview payload={payload} compact={compact} />
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={refreshing}
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--kaline-copper)] text-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper)]/10 disabled:opacity-50 disabled:cursor-wait transition"
            aria-label="Tentar novamente"
          >
            {refreshing ? "tentando…" : "↻ Tentar novamente"}
          </button>
        )}
        {details && (
          <>
            <button
              type="button"
              onClick={() => copyReadableDetails(message, details)}
              className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
            >
              copiar detalhes
            </button>
            <button
              type="button"
              onClick={() => copyErrorJson(payload)}
              className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
            >
              copiar json
            </button>
            <button
              type="button"
              onClick={() => downloadErrorJson(payload, details)}
              className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
            >
              baixar json
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
            >
              Ver detalhes →
            </button>
          </>
        )}
      </div>
      {open && details && (
        <ErrorModal
          message={message}
          details={details}
          onClose={() => setOpen(false)}
          compact={compact}
          onToggleCompact={toggleCompact}
        />
      )}
    </div>
  );
}

function InlineField({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt className="text-[color:var(--kaline-faint)] text-[10px] uppercase tracking-[0.2em] pt-0.5">
        {label}
      </dt>
      <dd className="text-[color:var(--kaline-text)] break-all">{value || "—"}</dd>
    </>
  );
}
const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

function ErrorModal({
  message,
  details,
  onClose,
  compact,
  onToggleCompact,
}: {
  message?: string;
  details: ApiErrorDetails;
  onClose: () => void;
  compact: boolean;
  onToggleCompact: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Autofocus: first focusable inside the dialog, or the dialog itself.
    const dialog = dialogRef.current;
    if (dialog) {
      const first = getFocusable(dialog)[0];
      (first ?? dialog).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const focusable = getFocusable(dialog);
        if (focusable.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialog.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    // Prevent body scroll while modal is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hestia-error-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-w-xl w-full max-h-[85vh] overflow-auto rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] p-6 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kaline-copper)]"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="kaline-eyebrow text-[color:var(--kaline-amber)]">
              {ORIGIN_LABEL[details.origin]}
            </p>
            <h3
              id="hestia-error-modal-title"
              className="kaline-serif text-2xl text-[color:var(--kaline-text)] mt-1"
            >
              Detalhes do erro
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-copper)] text-xl leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <section className="mt-5 space-y-2">
          <p className="kaline-eyebrow">Resumo</p>
          <p className="text-[13.5px] text-[color:var(--kaline-muted)] leading-relaxed">
            {humanSummary(details)}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Chip
              label="código"
              value={
                details.code ?? (details.httpStatus ? `HTTP_${details.httpStatus}` : undefined)
              }
              tone="code"
            />
            <Chip label="rota" value={details.route} tone="route" />
            <Chip
              label="timeout"
              value={
                details.origin === "timeout"
                  ? `${details.timeoutMs ?? "?"}ms · esgotado`
                  : details.timeoutMs != null
                    ? `${details.timeoutMs}ms`
                    : undefined
              }
              tone={details.origin === "timeout" ? "alert" : "muted"}
            />
          </div>
        </section>

        <section className="mt-5 space-y-2">
          <p className="kaline-eyebrow">Mensagem</p>
          <p className="font-mono text-[12.5px] text-[color:var(--kaline-text)] break-all">
            {message ?? "—"}
          </p>
        </section>

        <section className="mt-5">
          <p className="kaline-eyebrow mb-2">Campos estruturados</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 font-mono text-[12.5px]">
            <Field label="origem" value={details.origin} />
            <Field label="rota" value={details.route} />
            <Field label="http" value={details.httpStatus?.toString()} />
            <Field label="error" value={details.error} />
            <Field label="code" value={details.code} />
            <Field label="detail" value={details.detail} />
            <Field label="hint" value={details.hint} />
            <Field label="at" value={details.at} />
            <Field
              label="timeout"
              value={details.timeoutMs != null ? `${details.timeoutMs}ms` : undefined}
            />
          </dl>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="kaline-eyebrow">Payload JSON</p>
            <button
              type="button"
              onClick={onToggleCompact}
              className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--kaline-copper)] hover:text-[color:var(--kaline-amber)] transition"
              aria-label={compact ? "Expandir JSON" : "Compactar JSON"}
            >
              {compact ? "pretty print" : "compacto"}
            </button>
          </div>
          <JsonPreview payload={buildPayload(message, details)} compact={compact} />
        </section>

        {details.rawBody && (
          <section className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <p className="kaline-eyebrow">Corpo bruto</p>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--kaline-faint)]">
                {details.rawBody.split("\n").length} linhas · {details.rawBody.length} chars
              </span>
            </div>
            <RawBody text={details.rawBody} />
          </section>
        )}

        <footer className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => copyReadableDetails(message, details)}
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-copper)]"
          >
            copiar detalhes
          </button>

          <button
            type="button"
            onClick={() => copyErrorJson(buildPayload(message, details))}
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-copper)]"
          >
            copiar json
          </button>

          <button
            type="button"
            onClick={() => downloadErrorJson(buildPayload(message, details), details)}
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-copper)]"
          >
            baixar json
          </button>

          <button
            type="button"
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 rounded border border-[color:var(--kaline-copper)] text-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper)]/10"
          >
            fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt className="text-[color:var(--kaline-faint)] text-[10.5px] uppercase tracking-[0.22em] pt-0.5">
        {label}
      </dt>
      <dd className="text-[color:var(--kaline-text)] break-all">{value || "—"}</dd>
    </>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone: "code" | "route" | "alert" | "muted";
}) {
  if (!value) return null;
  const toneClass =
    tone === "alert"
      ? "border-[color:var(--kaline-amber)] text-[color:var(--kaline-amber)] bg-[color:var(--kaline-amber)]/10"
      : tone === "code"
        ? "border-[color:var(--kaline-copper)] text-[color:var(--kaline-copper)] bg-[color:var(--kaline-copper)]/10"
        : tone === "route"
          ? "border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-text)] bg-[color:var(--kaline-obsidian)]/60"
          : "border-[color:var(--kaline-border-copper)]/60 text-[color:var(--kaline-muted)]";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] ${toneClass}`}
    >
      <span className="uppercase tracking-[0.18em] text-[9.5px] opacity-70">{label}</span>
      <span className="break-all">{value}</span>
    </span>
  );
}

function RawBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const width = String(lines.length).length;
  return (
    <pre className="max-h-56 overflow-auto rounded border border-[color:var(--kaline-border-copper)]/60 bg-[color:var(--kaline-obsidian)]/70 p-0 text-[11.5px] leading-[1.55] text-[color:var(--kaline-muted)] font-mono">
      <code className="block">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3 px-3 hover:bg-[color:var(--kaline-copper)]/5">
            <span
              className="select-none text-right text-[color:var(--kaline-faint)]/70 tabular-nums shrink-0"
              style={{ width: `${width}ch` }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="whitespace-pre-wrap break-all text-[color:var(--kaline-text)]/90">
              {line || "\u00A0"}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}

function JsonPreview({ payload, compact }: { payload: unknown; compact: boolean }) {
  const text = formatJson(payload, compact);
  if (compact) {
    return (
      <pre className="overflow-auto rounded border border-[color:var(--kaline-border-copper)]/60 bg-[color:var(--kaline-obsidian)]/70 p-3 text-[11.5px] leading-[1.55] text-[color:var(--kaline-text)]/90 font-mono">
        <code className="whitespace-pre-wrap break-all">{text}</code>
      </pre>
    );
  }
  return <RawBody text={text} />;
}
