import { Download } from "lucide-react";
import { useInstallPrompt } from "./InstallPromptContext";

export function InstallHestiaButton() {
  const { promptEvent, install } = useInstallPrompt();

  if (!promptEvent) return null;

  return (
    <button
      type="button"
      onClick={() => void install()}
      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kaline-copper)] px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--kaline-copper)]"
    >
      <Download className="h-4 w-4" /> Instalar Héstia
    </button>
  );
}
