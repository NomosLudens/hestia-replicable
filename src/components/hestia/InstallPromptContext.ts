import { createContext, useContext } from "react";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallPromptState = {
  promptEvent: InstallPromptEvent | null;
  install: () => Promise<"accepted" | "dismissed" | null>;
};

export const InstallPromptContext = createContext<InstallPromptState | null>(null);

export function useInstallPrompt() {
  const value = useContext(InstallPromptContext);
  if (!value) throw new Error("useInstallPrompt requer InstallPromptProvider");
  return value;
}
