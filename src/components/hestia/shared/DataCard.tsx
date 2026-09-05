import { useState } from "react";
import type React from "react";

export type CardStatus = "ok" | "warn" | "error" | "loading" | "idle" | "unavailable" | "critical";

const STATUS_META: Record<CardStatus, { color: string; label: string; pulse: boolean }> = {
  ok: { color: "#4ade80", label: "operacional", pulse: false },
  warn: { color: "#facc15", label: "atenção", pulse: false },
  error: { color: "#f87171", label: "indisponível", pulse: false },
  critical: { color: "#ef4444", label: "crítico", pulse: true },
  loading: { color: "#60a5fa", label: "consultando", pulse: true },
  idle: { color: "#60a5fa", label: "informativo", pulse: false },
  unavailable: { color: "#9ca3af", label: "desconectado", pulse: false },
};

function getStatusMeta(status: CardStatus | string = "idle") {
  return STATUS_META[status as CardStatus] ?? STATUS_META.idle;
}

function StatusLight({ status }: { status?: CardStatus | string }) {
  const meta = getStatusMeta(status);
  return (
    <span
      className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor: meta.color,
        boxShadow: `0 0 8px ${meta.color}, 0 0 2px ${meta.color}`,
      }}
      aria-label={`status: ${meta.label}`}
      role="status"
    >
      {meta.pulse && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ backgroundColor: meta.color, opacity: 0.6 }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function DataCard({
  title,
  eyebrow,
  children,
  status = "idle",
  summary,
  collapsible = true,
  defaultOpen = false,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  status?: CardStatus | string;
  summary?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const meta = getStatusMeta(status);

  const header = (
    <div className="flex items-start justify-between gap-3 w-full text-left">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="pt-1.5">
          <StatusLight status={status} />
        </span>
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="kaline-eyebrow">{eyebrow}</p>}
          <h3 className="kaline-serif text-xl text-[color:var(--kaline-text)] truncate">{title}</h3>
          {!isOpen && (
            <p className="mt-1 text-[12px] text-[color:var(--kaline-faint)] truncate">
              {summary ?? meta.label}
            </p>
          )}
        </div>
      </div>
      {collapsible && (
        <span
          aria-hidden="true"
          className={`shrink-0 mt-1 text-[color:var(--kaline-copper)] text-sm transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
        >
          ›
        </span>
      )}
    </div>
  );

  return (
    <section className="rounded-xl border border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-surface)] overflow-hidden">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={isOpen}
          className="w-full p-5 hover:bg-[color:var(--kaline-copper)]/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kaline-copper)]/60"
        >
          {header}
        </button>
      ) : (
        <div className="p-5">{header}</div>
      )}
      {isOpen && (
        <div className="px-5 pb-5 pt-3 text-[13.5px] text-[color:var(--kaline-muted)] flex flex-col gap-2 border-t border-[color:var(--kaline-border-copper)]/40">
          {children}
        </div>
      )}
    </section>
  );
}
