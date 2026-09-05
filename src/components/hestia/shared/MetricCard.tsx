import { StatusPill } from "./StatusPill";
export function MetricCard({
  label,
  value,
  detail,
  status = "ok",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  status?: string;
}) {
  return (
    <div className="kaline-glass lift-card rounded-xl border border-[color:var(--kaline-border-copper)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="kaline-eyebrow">{label}</p>
        <StatusPill status={status} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-[color:var(--kaline-text)]">
        {value ?? "não disponível"}
      </div>
      {detail && <div className="mt-1 text-[12px] text-[color:var(--kaline-muted)]">{detail}</div>}
    </div>
  );
}
