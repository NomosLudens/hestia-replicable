import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  InstallPromptContext,
  type InstallPromptEvent,
  type InstallPromptState,
} from "./InstallPromptContext";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const value = useMemo<InstallPromptState>(
    () => ({
      promptEvent,
      install: async () => {
        if (!promptEvent) return null;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        setPromptEvent(null);
        return outcome;
      },
    }),
    [promptEvent],
  );

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}
