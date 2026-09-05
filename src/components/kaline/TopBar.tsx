import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./SidebarNav";
import { HESTIA } from "@/content/kaline";
import { useQuery } from "@tanstack/react-query";
import { hestiaApi } from "@/lib/hestia/api";
import { cn } from "@/lib/utils";
import kaApple from "@/assets/ka-apple.png";

function SambaIndicator() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => hestiaApi.health(),
    refetchInterval: 5000,
  });

  const isActive = data?.status === "ok" && data.data.sambaActive === true;
  const isFetched = data !== undefined;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden lg:inline text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
        Samba
      </span>
      <span
        title={isActive ? "Conectado ao HD via Tailscale" : "Desconectado do HD"}
        className={cn(
          "inline-block h-2 w-2 rounded-full transition-colors duration-300",
          !isFetched
            ? "bg-[color:var(--kaline-faint)]/50"
            : isActive
              ? "bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]"
              : "bg-[#ef4444] shadow-[0_0_8px_rgba(239,68,68,0.6)]",
        )}
      />
    </div>
  );
}

export function TopBar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--kaline-border-copper)] bg-[color:var(--kaline-obsidian)]/85 backdrop-blur-xl supports-[backdrop-filter]:bg-[color:var(--kaline-obsidian)]/70">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4 px-3 sm:px-6 md:px-8 h-14 md:h-16">
        <div className="flex items-center">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Abrir navegação"
                className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-md border border-[color:var(--kaline-border-copper)] text-[color:var(--kaline-copper)] hover:bg-[color:var(--kaline-copper)]/10"
              >
                <Menu className="h-4 w-4" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[88%] max-w-[340px] bg-[color:var(--kaline-obsidian)]/95 backdrop-blur-2xl border-r border-[color:var(--kaline-border-copper)] p-0 flex flex-col"
            >
              <SheetTitle className="sr-only">Navegação da Héstia</SheetTitle>
              <div className="p-5 border-b border-[color:var(--kaline-border-copper)]">
                <span className="kaline-serif text-xl text-[color:var(--kaline-text)]">
                  Héstia Console
                </span>
                <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--kaline-faint)]">
                  Chama Local · modo protegido
                </p>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <SidebarNav mobile onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <div className="min-w-0 flex justify-center lg:justify-start">
          <Link
            to="/"
            className="inline-flex items-center gap-3 min-w-0 max-w-full rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-[color:var(--kaline-copper)]/[0.06]"
            aria-label={`${HESTIA.appName} — Início`}
          >
            <img src={kaApple} alt="Logo" className="w-6 h-6 object-contain" />
            <span className="kaline-serif text-[18px] md:text-[20px] text-[color:var(--kaline-text)] tracking-tight truncate">
              Héstia Console
            </span>
            <span
              aria-hidden
              className="shrink-0 inline-block h-2 w-2 rounded-full bg-[color:var(--kaline-amber)] shadow-[0_0_10px_oklch(0.82_0.19_60/0.75)]"
            />
            <span className="hidden md:inline text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
              Chama Local
            </span>
          </Link>
        </div>

        <div className="w-10 h-10 lg:w-auto lg:h-auto flex items-center justify-end gap-4">
          <SambaIndicator />
          <span className="hidden lg:inline text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
            modo protegido
          </span>
        </div>
      </div>
    </header>
  );
}
