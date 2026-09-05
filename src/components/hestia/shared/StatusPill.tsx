import type { HardwareSeverity } from "@/lib/hestia/api";
export function StatusPill({ status }: { status: HardwareSeverity | string }) {
  const cls =
    status === "ok"
      ? "text-emerald-300 border-emerald-400/40"
      : status === "critical"
        ? "text-red-300 border-red-400/40"
        : status === "warn"
          ? "text-amber-300 border-amber-400/40"
          : "text-[color:var(--kaline-faint)] border-[color:var(--kaline-border-copper)]";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${cls}`}
    >
      {status || "não disponível"}
    </span>
  );
}
