import { type ReactNode } from "react";
import { TopBar } from "./TopBar";
import { SidebarNav } from "./SidebarNav";
import { HESTIA } from "@/content/kaline";

export function StationShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="flex flex-1">
        <aside className="hidden lg:flex flex-col shrink-0 w-[240px] xl:w-[260px] border-r border-[color:var(--kaline-border-copper)] min-h-[calc(100vh-4rem)] sticky top-16 self-start">
          <div className="px-5 pt-6 pb-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[color:var(--kaline-faint)]">
              Console local
            </p>
            <p className="mt-1 serif text-[15px] text-[color:var(--kaline-muted)]">
              Chama Local · modo protegido
            </p>
          </div>
          <div className="px-3 py-2 flex-1 overflow-y-auto">
            <SidebarNav />
          </div>
          <div className="p-4 border-t border-[color:var(--kaline-border-copper)] text-[10px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
            leitura por padrão · escrita local aprovada
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-8 lg:px-10 py-8 md:py-12">
          <div className="mx-auto max-w-[1200px]">{children}</div>
        </main>
      </div>
      <footer className="border-t border-[color:var(--kaline-border-copper)] px-4 sm:px-6 md:px-8 lg:px-10 py-6 text-center text-[11px] uppercase tracking-[0.28em] text-[color:var(--kaline-faint)]">
        {HESTIA.footer}
      </footer>
    </div>
  );
}
