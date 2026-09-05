import { describe, it, expect } from "vitest";
import { getCapabilities } from "./capabilities.js";

describe("getCapabilities", () => {
  it("retorna capabilities com mode 'tvbox-console'", () => {
    const caps = getCapabilities();
    expect(caps.mode).toBe("tvbox-console");
  });

  it("habilita leitura de health/metrics/events/snapshots/logs/config", () => {
    const caps = getCapabilities();
    expect(caps.reading.health).toBe(true);
    expect(caps.reading.metrics).toBe(true);
    expect(caps.reading.events).toBe(true);
    expect(caps.reading.snapshots).toBe(true);
    expect(caps.reading.logs).toBe(true);
    expect(caps.reading.config).toBe(true);
  });

  it("declara ausência de poder arbitrário", () => {
    const caps = getCapabilities();
    expect(caps.writing.executeCommands).toBe(false);
    expect(caps.writing.configureServices).toBe(false);
    expect(caps.writing.manageBackups).toBe(false);
    expect(caps.writing.modifyStorage).toBe(false);
    expect(caps.writing.manageUsers).toBe(false);
  });

  it("declara ausência de escrita local no Console da TV Box", () => {
    const caps = getCapabilities();
    expect(caps.writing.executeCommands).toBe(false);
    expect(caps.writing.configureServices).toBe(false);
    expect(caps.writing.manageBackups).toBe(false);
    expect(caps.writing.modifyStorage).toBe(false);
    expect(caps.writing.manageUsers).toBe(false);
  });
});
