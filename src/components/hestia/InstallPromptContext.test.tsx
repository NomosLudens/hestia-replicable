import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallHestiaButton } from "./InstallHestiaButton";
import { type InstallPromptEvent } from "./InstallPromptContext";
import { InstallPromptProvider } from "./InstallPromptProvider";

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as InstallPromptEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: "test" });
  return event;
}

function NavigationHarness() {
  const [config, setConfig] = useState(false);
  return (
    <>
      <button onClick={() => setConfig(true)}>Abrir config</button>
      {config ? <InstallHestiaButton /> : null}
    </>
  );
}

describe("InstallPromptProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preserva o evento capturado no root até a navegação posterior para config", () => {
    render(
      <InstallPromptProvider>
        <NavigationHarness />
      </InstallPromptProvider>,
    );
    const event = installEvent();
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByText("Instalar Héstia")).toBeNull();
    fireEvent.click(screen.getByText("Abrir config"));
    expect(screen.getByText("Instalar Héstia")).toBeTruthy();
  });

  it("limpa o prompt aceito sem mostrar sucesso falso", async () => {
    render(
      <InstallPromptProvider>
        <InstallHestiaButton />
      </InstallPromptProvider>,
    );
    const event = installEvent("accepted");
    act(() => window.dispatchEvent(event));
    fireEvent.click(screen.getByText("Instalar Héstia"));
    await waitFor(() => expect(event.prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText("Instalar Héstia")).toBeNull());
  });

  it("limpa em appinstalled e trata dismissed sem exceção", async () => {
    render(
      <InstallPromptProvider>
        <InstallHestiaButton />
      </InstallPromptProvider>,
    );
    act(() => window.dispatchEvent(installEvent("dismissed")));
    fireEvent.click(screen.getByText("Instalar Héstia"));
    await waitFor(() => expect(screen.queryByText("Instalar Héstia")).toBeNull());

    act(() => window.dispatchEvent(installEvent()));
    expect(screen.getByText("Instalar Héstia")).toBeTruthy();
    act(() => window.dispatchEvent(new Event("appinstalled")));
    expect(screen.queryByText("Instalar Héstia")).toBeNull();
  });

  it("não mostra botão sem evento ou em standalone", () => {
    const { unmount } = render(
      <InstallPromptProvider>
        <InstallHestiaButton />
      </InstallPromptProvider>,
    );
    expect(screen.queryByText("Instalar Héstia")).toBeNull();
    unmount();

    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(
      <InstallPromptProvider>
        <InstallHestiaButton />
      </InstallPromptProvider>,
    );
    act(() => window.dispatchEvent(installEvent()));
    expect(screen.queryByText("Instalar Héstia")).toBeNull();
  });
});
