import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countOnlineStations,
  hestiaApi,
  type StationId,
  type StationSystem,
} from "@/lib/hestia/api";
import { STATION_UI, StationCard } from "./_station.index";

vi.mock("@/lib/hestia/api", async (original) => {
  const actual = await original<typeof import("@/lib/hestia/api")>();
  return {
    ...actual,
    hestiaApi: {
      ...actual.hestiaApi,
      stationConnection: vi.fn(),
      stationStorage: vi.fn(),
      stationSystem: vi.fn(),
      stationServices: vi.fn(),
      tvboxCodiceHealth: vi.fn(),
      stationTunnelStatus: vi.fn(),
      wakeServer: vi.fn(),
      sleepServer: vi.fn(),
    },
  };
});

const at = "2026-07-16T12:00:00.000Z";
const ok = <T,>(data: T) => ({ status: "ok" as const, data, fetchedAt: at });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("counts online Stations only from observed available connections", () => {
  const connections = Object.fromEntries(
    ["desktop", "tvbox", "pocket", "baby", "mini", "max", "note", "kaos"].map((id, index) => [
      id,
      index < 2
        ? {
            ok: true,
            configured: true,
            state: "available",
            checkedAt: at,
            latencyMs: 1,
            station: null,
          }
        : null,
    ]),
  ) as Parameters<typeof countOnlineStations>[0];

  expect(countOnlineStations(connections)).toBe(2);
});

function system() {
  const data: StationSystem = {
    ok: true,
    schemaVersion: 1,
    checkedAt: at,
    system: {
      hostname: "station-host",
      platform: "linux",
      release: "6.8",
      arch: "x64",
      uptimeSeconds: 60,
      cpu: { model: "cpu", cores: 1, threads: 1, loadAverage: [0, 0, 0], usagePercent: null },
      memory: { totalBytes: 100, usedBytes: 50, freeBytes: 50, usedPercent: 50 },
      swap: { totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPercent: 0 },
      rootDisk: { totalBytes: 100, usedBytes: 10, freeBytes: 90, usedPercent: 10 },
    },
  };
  return ok(data);
}

function prepare(id: StationId, state: "available" | "unavailable" = "available") {
  vi.mocked(hestiaApi.stationConnection).mockImplementation(async (requested) =>
    ok({
      ok: true,
      configured: true,
      state: requested === id ? state : "unavailable",
      checkedAt: at,
      latencyMs: 2,
      station:
        state === "available"
          ? { service: "hestia-station-agent", schemaVersion: 1, version: "test" }
          : null,
    }),
  );
  vi.mocked(hestiaApi.stationSystem).mockResolvedValue(system());
  vi.mocked(hestiaApi.stationStorage).mockResolvedValue(
    ok({
      ok: true,
      schemaVersion: 1,
      checkedAt: at,
      storage: {
        id: "kaline",
        exists: true,
        status: "ok",
        totalBytes: 10,
        usedBytes: 5,
        freeBytes: 5,
        percentUsed: 50,
      },
    }),
  );
  vi.mocked(hestiaApi.stationServices).mockResolvedValue(
    ok({ ok: true, schemaVersion: 1, checkedAt: at, services: [] }),
  );
  vi.mocked(hestiaApi.tvboxCodiceHealth).mockResolvedValue(
    ok({
      ok: true,
      state: "available",
      libraryAvailable: true,
      formats: ["epub", "pdf"],
      checkedAt: at,
    }),
  );
  vi.mocked(hestiaApi.stationTunnelStatus).mockResolvedValue(
    ok({
      ok: true,
      schemaVersion: 1,
      status: "unsupported",
      checkedAt: at,
      tunnel: {
        name: "",
        connected: false,
        haConnections: 0,
        protocol: "unknown",
        edgeColo: null,
      },
      publicRoute: {
        hostname: null,
        status: "not_configured",
        httpStatus: null,
        latencyMs: null,
        checkedAt: at,
      },
    }),
  );
}

function renderCard(id: StationId) {
  const station = STATION_UI.find((item) => item.id === id)!;
  render(<StationCard {...station} />);
}

describe("monitoramento visual das Stations", () => {
  it("mantém registro visual com cards para todas as Stations canônicas", () => {
    expect(STATION_UI.map((station) => station.id)).toEqual([
      "desktop",
      "tvbox",
      "pocket",
      "baby",
      "mini",
      "max",
      "note",
      "kaos",
    ]);
    expect(STATION_UI.map((station) => station.title)).toEqual([
      "Servidor",
      "TV Box",
      "Pocket",
      "Baby",
      "Mini",
      "Max",
      "Notebook",
      "KAOS",
    ]);
  });

  it("usa endpoints do Servidor sem consultar Códice", async () => {
    prepare("desktop");
    renderCard("desktop");
    expect(await screen.findByText("Servidor")).toBeTruthy();
    await waitFor(() => expect(hestiaApi.stationConnection).toHaveBeenCalledWith("desktop"));
    expect(hestiaApi.tvboxCodiceHealth).not.toHaveBeenCalled();
  });

  it("mantém TV Box independente da falha do Servidor sem apresentar Códice", async () => {
    prepare("tvbox");
    renderCard("tvbox");
    expect(await screen.findByText("TV Box")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /TV Box/i }));
    expect(screen.queryByText("Biblioteca Códice")).toBeNull();
  });

  it("Pocket, Baby, Mini e Max não consultam Códice, Organizer nem /KALINE", async () => {
    prepare("pocket");
    renderCard("pocket");
    renderCard("baby");
    renderCard("mini");
    renderCard("max");
    expect((await screen.findAllByText("Pocket")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Baby")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Mini")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Max")).length).toBeGreaterThan(0);
    expect(hestiaApi.tvboxCodiceHealth).not.toHaveBeenCalled();
    expect(screen.queryByText("Organizer")).toBeNull();
    await waitFor(() => expect(hestiaApi.stationSystem).toHaveBeenCalledWith("pocket"));
    expect(hestiaApi.stationStorage).not.toHaveBeenCalledWith("pocket");
    expect(hestiaApi.stationStorage).not.toHaveBeenCalledWith("baby");
    expect(hestiaApi.stationStorage).not.toHaveBeenCalledWith("mini");
    expect(hestiaApi.stationStorage).not.toHaveBeenCalledWith("max");
    expect(hestiaApi.tvboxCodiceHealth).not.toHaveBeenCalled();
  });

  it("mantém indisponibilidade independente entre Pocket e Baby", async () => {
    vi.mocked(hestiaApi.stationConnection).mockImplementation(async (requested) =>
      ok({
        ok: true,
        configured: true,
        state: requested === "pocket" ? "unavailable" : "available",
        checkedAt: at,
        latencyMs: requested === "pocket" ? null : 3,
        station:
          requested === "pocket"
            ? null
            : { service: "hestia-station-agent", schemaVersion: 1, version: "test" },
      }),
    );
    vi.mocked(hestiaApi.stationSystem).mockResolvedValue(system());
    vi.mocked(hestiaApi.stationServices).mockResolvedValue(
      ok({ ok: true, schemaVersion: 1, checkedAt: at, services: [] }),
    );
    renderCard("pocket");
    renderCard("baby");
    expect((await screen.findAllByText("Pocket")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Baby")).length).toBeGreaterThan(0);
    await waitFor(() => expect(hestiaApi.stationConnection).toHaveBeenCalledWith("baby"));
    expect(screen.getAllByText("offline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("online").length).toBeGreaterThan(0);
  });

  it("somente tvbox e max consultam stationTunnelStatus", async () => {
    prepare("desktop");
    renderCard("desktop");
    renderCard("pocket");
    renderCard("baby");
    renderCard("mini");
    renderCard("note");
    expect(hestiaApi.stationTunnelStatus).not.toHaveBeenCalled();

    renderCard("tvbox");
    expect(hestiaApi.stationTunnelStatus).toHaveBeenCalledWith("tvbox");

    renderCard("max");
    expect(hestiaApi.stationTunnelStatus).toHaveBeenCalledWith("max");
  });

  it("valida papéis reais das Stations", () => {
    const roles = Object.fromEntries(STATION_UI.map((item) => [item.id, item.role]));
    expect(roles.desktop).toBe(
      "/KALINE · backup · processamento · serviços pesados sob demanda · Ash Gate",
    );
    expect(roles.tvbox).toBe("Ash runtime · infraestrutura doméstica");
    expect(roles.pocket).toBe("ZeroClaw · Khora");
    expect(roles.baby).toBe("Reserva cloud");
    expect(roles.mini).toBe("Kódice");
    expect(roles.max).toBe("Cauldron / Kallistis VTT");
    expect(roles.note).toBe("Workstation principal de desenvolvimento");
  });

  it("valida declaração de onDemand para desktop e max", () => {
    const onDemandMap = Object.fromEntries(STATION_UI.map((item) => [item.id, item.onDemand]));
    expect(onDemandMap.desktop).toBe(true);
    expect(onDemandMap.max).toBe(true);
    expect(onDemandMap.tvbox).toBe(false);
    expect(onDemandMap.pocket).toBe(false);
    expect(onDemandMap.baby).toBe(false);
    expect(onDemandMap.mini).toBe(false);
    expect(onDemandMap.note).toBe(false);
  });

  it("exibe repouso (sob demanda) e botão Acordar servidor quando desktop está offline", async () => {
    prepare("desktop", "unavailable");
    vi.mocked(hestiaApi.wakeServer).mockResolvedValue(
      ok({ ok: true, state: "wake_requested", target: "desktop" }),
    );

    renderCard("desktop");
    expect(await screen.findByText("Servidor")).toBeTruthy();
    expect(await screen.findByText("repouso (sob demanda)")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Servidor/i }));

    const wakeBtn = await screen.findByRole("button", { name: /Acordar servidor/i });
    expect(wakeBtn).toBeTruthy();

    await userEvent.click(wakeBtn);
    expect(hestiaApi.wakeServer).toHaveBeenCalled();
  });

  it("exibe offline para host always_on quando indisponível", async () => {
    prepare("mini", "unavailable");
    renderCard("mini");
    expect(await screen.findByText("Mini")).toBeTruthy();
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Acordar servidor/i })).toBeNull();
  });

  it("exibe botão Dormir servidor quando desktop está online", async () => {
    prepare("desktop", "available");
    vi.mocked(hestiaApi.sleepServer).mockResolvedValue(
      ok({ ok: true, state: "sleep_requested", target: "desktop" }),
    );

    renderCard("desktop");
    expect(await screen.findByText("Servidor")).toBeTruthy();

    const cardToggle = await screen.findByRole("button", { name: /Servidor/i });
    await userEvent.click(cardToggle);

    const sleepBtn = await screen.findByRole("button", { name: /Dormir servidor/i });
    expect(sleepBtn).toBeTruthy();

    await userEvent.click(sleepBtn);
    expect(hestiaApi.sleepServer).toHaveBeenCalled();
  });
});
