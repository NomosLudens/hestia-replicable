import type React from "react";

export function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[color:var(--kaline-border-copper)]/40 pb-1.5 last:border-0 last:pb-0">
      <span className="text-[color:var(--kaline-faint)] text-[11px] uppercase tracking-[0.22em]">
        {k}
      </span>
      <span className="text-right font-mono text-[12.5px] text-[color:var(--kaline-text)] break-all">
        {v}
      </span>
    </div>
  );
}
