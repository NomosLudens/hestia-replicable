import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { InstallPromptProvider } from "@/components/hestia/InstallPromptProvider";

function NotFoundComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="kaline-eyebrow">Rota fora do mapa</p>
        <h1 className="mt-3 kaline-serif text-6xl text-[color:var(--kaline-text)]">404</h1>
        <p className="mt-3 text-[color:var(--kaline-muted)]">
          Este cômodo da Héstia ainda não existe.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kaline-border-copper)] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)]"
          >
            Voltar ao painel
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="kaline-eyebrow">Interferência no painel</p>
        <h1 className="mt-3 kaline-serif text-2xl text-[color:var(--kaline-text)]">
          A tela não pôde ser desenhada agora
        </h1>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kaline-copper)]/60 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-copper)]"
          >
            tentar de novo
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kaline-border-copper)] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--kaline-muted)]"
          >
            voltar ao painel
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Héstia Console — Interface local da Héstia" },
      {
        name: "description",
        content:
          "Console local modo protegido da Héstia, com Chama Local embutida para medir saúde, hardware, logs, configuração e serviços da TV Box.",
      },
      { name: "author", content: "Estação Kaline" },
      { name: "theme-color", content: "#191415" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "Héstia Console — Interface local da Héstia" },
      {
        property: "og:description",
        content:
          "Frontend local + Chama Local embutida. Somente leitura. Nenhuma métrica inventada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        type: "image/png",
        href: "/icons/hestia-192.png",
      },
      { rel: "apple-touch-icon", href: "/icons/hestia-192.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <InstallPromptProvider>
        <TooltipProvider delayDuration={300}>
          <Outlet />
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--kaline-surface)",
                border: "1px solid var(--kaline-border-copper)",
                color: "var(--kaline-text)",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: "12.5px",
              },
            }}
          />
        </TooltipProvider>
      </InstallPromptProvider>
    </QueryClientProvider>
  );
}
