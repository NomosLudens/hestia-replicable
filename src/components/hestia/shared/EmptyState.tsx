export function EmptyState({ children = "não disponível" }: { children?: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-[color:var(--kaline-border-copper)]/60 p-3 text-[12px] text-[color:var(--kaline-faint)]">
      {children}
    </p>
  );
}
