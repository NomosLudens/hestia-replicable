import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config.storageSources", () => {
  let tmpHome;
  let kalineRoot;

  afterEach(async () => {
    vi.resetModules();
    delete process.env.HOME;
    delete process.env.HESTIA_STORAGE_PATH;
    if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true });
    if (kalineRoot) await fs.rm(kalineRoot, { recursive: true, force: true });
  });

  async function loadConfigWith(content) {
    tmpHome = await mkdtemp(join(tmpdir(), "hestia-home-"));
    kalineRoot = await mkdtemp(join(tmpdir(), "hestia-kaline-"));
    process.env.HOME = tmpHome;
    process.env.HESTIA_STORAGE_PATH = kalineRoot;
    if (content !== null) {
      await fs.mkdir(join(tmpHome, ".chama"), { recursive: true });
      await fs.writeFile(join(tmpHome, ".chama", "config.json"), content, "utf8");
    }
    vi.resetModules();
    return import("./config.js");
  }

  it("lê fontes válidas de ~/.chama/config.json", async () => {
    const externalRoot = join(tmpdir(), `hestia-external-${Date.now()}`);
    const { config } = await loadConfigWith(
      JSON.stringify({
        storageSources: [
          {
            id: " filmes ",
            label: " Filmes ",
            path: ` ${externalRoot} `,
            category: " midia/videos ",
            mode: "external-readonly",
          },
        ],
      }),
    );
    expect(config.storageSources).toEqual([
      {
        id: "filmes",
        label: "Filmes",
        path: externalRoot,
        category: "midia/videos",
        mode: "external-readonly",
      },
    ]);
  });

  it("JSON inválido ou arquivo ausente resulta em []", async () => {
    let loaded = await loadConfigWith("{");
    expect(loaded.config.storageSources).toEqual([]);
    await fs.rm(tmpHome, { recursive: true, force: true });
    tmpHome = null;

    loaded = await loadConfigWith(null);
    expect(loaded.config.storageSources).toEqual([]);
  });
});
