import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hestiaApi,
  type ApplicationItem,
  type StationAppsResult,
  type StationId,
  type StationUpdates,
} from "@/lib/hestia/api";
import { UpdatesDoDia } from "./_station.updates";

vi.mock("@/lib/hestia/api", async (original) => {
  const actual = await original<typeof import("@/lib/hestia/api")>();
  return {
    ...actual,
    hestiaApi: {
      ...actual.hestiaApi,
      stationConnection: vi.fn(),
      stationUpdates: vi.fn(),
      stationApps: vi.fn(),
      updateStationApp: vi.fn(),
    },
  };
});

const at = "2026-08-19T15:00:00.000Z";
const ok = <T,>(data: T) => ({ status: "ok" as const, data, fetchedAt: at });
const unavailable = (message: string) => ({
  status: "unavailable" as const,
  message,
  fetchedAt: at,
  details: { origin: "network" as const, route: "POST", detail: message, hint: "" },
});

function stationConnection(id: StationId, state: "available" | "not_configured" = "available") {
  vi.mocked(hestiaApi.stationConnection).mockImplementation(async (requested) =>
    ok({
      ok: true,
      configured: true,
      state: requested === id ? state : "unavailable",
      checkedAt: at,
      latencyMs: 1,
      station:
        state === "available"
          ? { service: "hestia-station-agent", schemaVersion: 1, version: "test" }
          : null,
    }),
  );
}

function stationUpdates(id: StationId, data: Partial<StationUpdates> | null = null) {
  const value: StationUpdates = (data ?? {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: at,
    updates: [],
    totalUpdates: 0,
    securityUpdates: 0,
    rebootRequired: false,
  }) as StationUpdates;
  vi.mocked(hestiaApi.stationUpdates).mockImplementation(async (requested) =>
    requested === id ? ok(value) : unavailable("not configured"),
  );
}

function makeApp(overrides: Partial<ApplicationItem>): ApplicationItem {
  return {
    id: "apt:test",
    name: "Test App",
    installedVersion: "1.0.0",
    availableVersion: null,
    updateStatus: "up_to_date",
    source: "apt",
    packageId: "test",
    executable: null,
    desktopEntry: null,
    managed: true,
    updateCapability: "controlled",
    checkedAt: at,
    ...overrides,
  };
}

function stationApps(id: StationId, apps: ApplicationItem[]) {
  const data: StationAppsResult = {
    ok: true,
    schemaVersion: 1,
    status: "ok",
    checkedAt: at,
    applications: apps,
    summary: {
      totalInstalled: apps.length,
      upToDate: apps.filter((a) => a.updateStatus === "up_to_date").length,
      updateAvailable: apps.filter((a) => a.updateStatus === "update_available").length,
      unknownVerification: apps.filter(
        (a) => a.updateStatus === "unknown" || a.updateStatus === "unsupported",
      ).length,
    },
    providers: {
      apt: true,
      desktopEntry: true,
      flatpak: false,
      snap: false,
    },
  };
  vi.mocked(hestiaApi.stationApps).mockImplementation(async (requested) =>
    requested === id ? ok(data) : unavailable("not configured"),
  );
}

function prepareDesktop(apps: ApplicationItem[]) {
  stationConnection("desktop");
  stationUpdates("desktop");
  stationApps("desktop", apps);
}

async function openAppsListForDesktop() {
  const trigger = await screen.findByRole("button", { name: /Ver aplicativos/ });
  await userEvent.click(trigger);
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hostname: "localhost",
      protocol: "http:",
      href: "http://localhost:4517/",
      origin: "http://localhost:4517",
      host: "localhost:4517",
      port: "4517",
      pathname: "/",
      search: "",
      hash: "",
      assign: vi.fn(),
      reload: vi.fn(),
      replace: vi.fn(),
      toString: () => "http://localhost:4517/",
    },
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Updates do Dia — modal de autorização de app controlável", () => {
  it("renderiza título, summary e as 7 Stations", async () => {
    stationConnection("desktop");
    stationUpdates("desktop");
    stationApps("desktop", []);
    stationConnection("tvbox");
    stationUpdates("tvbox");
    stationApps("tvbox", []);
    stationConnection("pocket");
    stationUpdates("pocket");
    stationApps("pocket", []);
    stationConnection("baby");
    stationUpdates("baby");
    stationApps("baby", []);
    stationConnection("mini");
    stationUpdates("mini");
    stationApps("mini", []);
    stationConnection("max");
    stationUpdates("max");
    stationApps("max", []);
    stationConnection("note");
    stationUpdates("note");
    stationApps("note", []);

    render(<UpdatesDoDia />);

    expect(await screen.findByText("Updates do Dia")).toBeTruthy();
    expect(await screen.findByText("Ação Controlada")).toBeTruthy();
    expect(await screen.findByText("Servidor")).toBeTruthy();
    expect(await screen.findByText("TV Box")).toBeTruthy();
    expect(await screen.findByText("Pocket")).toBeTruthy();
    expect(await screen.findByText("Baby")).toBeTruthy();
    expect(await screen.findByText("Mini")).toBeTruthy();
    expect(await screen.findByText("MAX")).toBeTruthy();
    expect(await screen.findByText("Notebook")).toBeTruthy();
  });

  it("mostra o botão Atualizar apenas para app controlável com update disponível", async () => {
    const updateable = makeApp({
      id: "apt:updateable",
      name: "Updateable",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "2.0.0",
    });
    const upToDate = makeApp({
      id: "apt:up-to-date",
      name: "UpToDate",
      updateStatus: "up_to_date",
      availableVersion: null,
    });
    const manual = makeApp({
      id: "apt:manual",
      name: "ManualOnly",
      updateStatus: "update_available",
      updateCapability: "manual",
      availableVersion: "1.1.0",
    });
    const notManaged = makeApp({
      id: "apt:not-managed",
      name: "Unmanaged",
      updateStatus: "update_available",
      updateCapability: "none",
      availableVersion: "0.9.0",
    });
    prepareDesktop([updateable, upToDate, manual, notManaged]);

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    await waitFor(() => expect(hestiaApi.stationApps).toHaveBeenCalledWith("desktop"));

    const updateableBtn = screen.getByRole("button", { name: /^Atualizar$/ });
    expect(updateableBtn).toBeTruthy();
    expect(screen.queryByText("ManualOnly")).toBeTruthy();
    expect(screen.queryByText("Unmanaged")).toBeTruthy();
    expect(screen.queryByText("UpToDate")).toBeTruthy();

    expect(
      screen.getByText((content, node) => {
        if (!node) return false;
        return node.textContent === "Atualizar" && node.tagName === "BUTTON";
      }),
    ).toBeTruthy();
  });

  it("abre o modal de autorização ao clicar em Atualizar, aceita senha e fecha ao cancelar", async () => {
    const updateable = makeApp({
      id: "apt:hd",
      name: "Heavy Duty",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "9.0.0",
    });
    prepareDesktop([updateable]);

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const modal = await screen.findByRole("dialog", { hidden: false });
    expect(modal).toBeTruthy();
    expect((await screen.findAllByText("Heavy Duty")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText(/Senha sudo desta Station/i)).toBeTruthy();

    const passwordInput = screen.getByLabelText(/Senha sudo desta Station/i) as HTMLInputElement;
    await userEvent.type(passwordInput, "minha-senha-secreta-123");
    expect(passwordInput.value).toBe("minha-senha-secreta-123");

    const cancelBtn = screen.getByRole("button", { name: /Cancelar/ });
    await userEvent.click(cancelBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(/Senha sudo desta Station/i)).toBeNull();
  });

  it("envia a senha transiente ao chamar updateStationApp e trata sucesso", async () => {
    const updateable = makeApp({
      id: "apt:firefox",
      name: "Firefox",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "130.0",
    });
    prepareDesktop([updateable]);

    vi.mocked(hestiaApi.updateStationApp).mockResolvedValue(
      ok({
        ok: true,
        status: "updated",
        appId: "apt:firefox",
        name: "Firefox",
        installedVersion: "130.0",
      }),
    );

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const passwordInput = await screen.findByLabelText(/Senha sudo desta Station/i);
    await userEvent.type(passwordInput, "sudo1234");

    const submitBtn = await screen.findByRole("button", { name: /Autorizar/ });
    await userEvent.click(submitBtn);

    await waitFor(() =>
      expect(hestiaApi.updateStationApp).toHaveBeenCalledWith("desktop", "apt:firefox", "sudo1234"),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(hestiaApi.updateStationApp).toHaveBeenCalledTimes(1);
    const lastCall = vi.mocked(hestiaApi.updateStationApp).mock.calls.at(-1);
    expect(lastCall).toEqual(["desktop", "apt:firefox", "sudo1234"]);
  });

  it("NÃO propaga a senha pela estrutura do body mais do que o necessário (sem shell injection)", async () => {
    const updateable = makeApp({
      id: "apt:vim",
      name: "vim",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "9.0",
    });
    prepareDesktop([updateable]);

    vi.mocked(hestiaApi.updateStationApp).mockResolvedValue(
      ok({
        ok: true,
        status: "updated",
        appId: "apt:vim",
        name: "vim",
        installedVersion: "9.0",
      }),
    );

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const passwordInput = await screen.findByLabelText(/Senha sudo desta Station/i);
    await userEvent.type(passwordInput, "; rm -rf /");

    const submitBtn = await screen.findByRole("button", { name: /Autorizar/ });
    await userEvent.click(submitBtn);

    await waitFor(() =>
      expect(hestiaApi.updateStationApp).toHaveBeenCalledWith("desktop", "apt:vim", "; rm -rf /"),
    );
    expect(hestiaApi.updateStationApp).toHaveBeenCalledTimes(1);
  });

  it("exibe erro AUTHORIZATION_FAILED sem vazar a senha", async () => {
    const updateable = makeApp({
      id: "apt:htop",
      name: "htop",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "3.3.0",
    });
    prepareDesktop([updateable]);

    vi.mocked(hestiaApi.updateStationApp).mockResolvedValue(
      ok({ ok: false, code: "AUTHORIZATION_FAILED", error: "negado" }),
    );

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const passwordInput = await screen.findByLabelText(/Senha sudo desta Station/i);
    await userEvent.type(passwordInput, "errada");

    const submitBtn = await screen.findByRole("button", { name: /Autorizar/ });
    await userEvent.click(submitBtn);

    expect(await screen.findByText(/Senha sudo incorreta ou autorização negada\./)).toBeTruthy();
    expect(screen.queryByText(/errada/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("trata erro de rede unavailable sem fechar modal e mostra mensagem técnica", async () => {
    const updateable = makeApp({
      id: "apt:curl",
      name: "curl",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "8.7.0",
    });
    prepareDesktop([updateable]);

    vi.mocked(hestiaApi.updateStationApp).mockResolvedValue(
      unavailable("POST /api/stations/desktop/apps/apt:curl/update: Chama Local caiu"),
    );

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const passwordInput = await screen.findByLabelText(/Senha sudo desta Station/i);
    await userEvent.type(passwordInput, "qualquer");

    const submitBtn = await screen.findByRole("button", { name: /Autorizar/ });
    await userEvent.click(submitBtn);

    expect(
      await screen.findByText(/POST \/api\/stations\/desktop\/apps\/apt:curl\/update/),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("NÃO exibe botão Atualizar para Station não-configurada", async () => {
    stationConnection("desktop", "not_configured");
    stationUpdates("desktop");
    stationApps("desktop", []);
    render(<UpdatesDoDia />);

    expect(await screen.findByText(/NÃO CONFIGURADO/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver aplicativos/ })).toBeNull();
  });

  it("registra o modal como escopo de teste isolado (não vaza UI)", async () => {
    const updateable = makeApp({
      id: "apt:zsh",
      name: "zsh",
      updateStatus: "update_available",
      updateCapability: "controlled",
      availableVersion: "5.9",
    });
    prepareDesktop([updateable]);

    render(<UpdatesDoDia />);
    await openAppsListForDesktop();

    const updateBtn = await screen.findByRole("button", { name: /^Atualizar$/ });
    await userEvent.click(updateBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("authorize-modal-title");
  });
});
