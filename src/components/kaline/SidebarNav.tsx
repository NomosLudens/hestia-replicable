import { Link, useRouterState } from "@tanstack/react-router";
import { nav } from "@/content/kaline";
import { cn } from "@/lib/utils";

export function SidebarNav({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-col gap-1">
      <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.32em] text-[color:var(--kaline-faint)]">
        Héstia
      </div>
      {nav.map((n) => {
        const active =
          n.to === "/" ? pathname === "/" : pathname === n.to || pathname.startsWith(n.to + "/");
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 pl-5 pr-3 rounded-md border border-transparent transition-colors duration-150 outline-none focus-visible:border-[color:var(--kaline-copper)]/60",
              mobile ? "min-h-11 py-2.5" : "py-2",
              active
                ? "border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-copper)]/12 text-[color:var(--kaline-text)]"
                : "text-[color:var(--kaline-muted)] hover:text-[color:var(--kaline-text)] hover:bg-white/[0.03] hover:border-[color:var(--kaline-copper)]/20",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute left-1 top-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
                active
                  ? "h-5 w-[3px] bg-[color:var(--kaline-ember)] shadow-[0_0_10px_oklch(0.70_0.28_38/0.65)]"
                  : "h-1.5 w-1.5 bg-[color:var(--kaline-copper)] opacity-25 group-hover:opacity-70",
              )}
            />
            <span className="serif text-[15px] tracking-tight flex-1 truncate">{n.label}</span>
            {n.hint && !mobile && (
              <span
                className={cn(
                  "text-[9px] uppercase tracking-[0.22em] truncate",
                  active
                    ? "text-[color:var(--kaline-copper)]"
                    : "text-[color:var(--kaline-faint)]/70",
                )}
              >
                {n.hint}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
