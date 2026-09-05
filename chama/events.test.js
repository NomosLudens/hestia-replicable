import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs";
import { tmpdir } from "node:os";
import { buildEvent, appendEvent, getRecentEvents } from "./events.js";

describe("buildEvent", () => {
  it("cria evento com campos padrão", () => {
    const event = buildEvent({ type: "test.event" });
    expect(event.type).toBe("test.event");
    expect(event.visibility).toBe("presence-safe");
    expect(event.timestamp).toBeDefined();
    expect(event.data).toEqual({});
  });

  it("respeita visibility customizada", () => {
    const event = buildEvent({ type: "test", visibility: "internal" });
    expect(event.visibility).toBe("internal");
  });

  it("respeita data customizada", () => {
    const customData = { message: "test" };
    const event = buildEvent({ type: "test", data: customData });
    expect(event.data).toEqual(customData);
  });
});

describe("appendEvent / getRecentEvents", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await new Promise((resolve, reject) =>
      mkdtemp(join(tmpdir(), "hestia-events-"), (err, dir) => {
        if (err) reject(err);
        else resolve(dir);
      }),
    );
    await fs.mkdir(join(tmpDir, "events"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("append grava evento em JSONL e getRecentEvents o recupera", async () => {
    await appendEvent({ type: "test.start" }, tmpDir);
    const events = await getRecentEvents({ limit: 10 }, tmpDir);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("test.start");
  });

  it("respeita limit", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent({ type: `test.${i}` }, tmpDir);
    }
    const events = await getRecentEvents({ limit: 3 }, tmpDir);
    expect(events.length).toBe(3);
  });

  it("retorna eventos em ordem mais-recente-primeiro", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000);

    await appendEvent({ type: "test.old", timestamp: past.toISOString() }, tmpDir);
    await appendEvent({ type: "test.new", timestamp: now.toISOString() }, tmpDir);

    const events = await getRecentEvents({ limit: 10 }, tmpDir);
    expect(events[0].type).toBe("test.new");
    expect(events[1].type).toBe("test.old");
  });

  it("ignora linhas corrompidas ao ler", async () => {
    const eventsDir = join(tmpDir, "events");
    const today = new Date().toISOString().split("T")[0];
    const eventPath = join(eventsDir, `events-${today}.jsonl`);

    const validEvent = JSON.stringify({ type: "valid", timestamp: new Date().toISOString() });
    const badLine = "{ broken json";
    const content = `${validEvent}\n${badLine}\n${validEvent}\n`;

    await fs.writeFile(eventPath, content, "utf8");

    const events = await getRecentEvents({ limit: 10 }, tmpDir);
    expect(events.length).toBe(2);
    expect(events.every((e) => e.type === "valid")).toBe(true);
  });

  it("retorna [] se não há eventos", async () => {
    const events = await getRecentEvents({ limit: 10 }, tmpDir);
    expect(events).toEqual([]);
  });
});
