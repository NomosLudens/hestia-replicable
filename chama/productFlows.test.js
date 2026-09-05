import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function pngSize(path) {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("fluxos de produto da Console", () => {
  it("declara PWA instalável sem service worker ou cache", () => {
    const manifest = JSON.parse(readFileSync(join(root, "public/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({
      name: "Héstia Console",
      short_name: "Héstia",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    for (const icon of manifest.icons) {
      const path = join(root, "public", icon.src.replace(/^\//, ""));
      expect(existsSync(path)).toBe(true);
      const expected = Number(icon.sizes.split("x", 1)[0]);
      expect(pngSize(path)).toEqual({ width: expected, height: expected });
      expect(icon.purpose).toContain("maskable");
    }
    const rootRoute = readFileSync(join(root, "src/routes/__root.tsx"), "utf8");
    expect(rootRoute).toContain('rel: "manifest"');
    expect(rootRoute).toContain('name: "theme-color"');
    expect(existsSync(join(root, "public/sw.js"))).toBe(false);
    expect(existsSync(join(root, "public/service-worker.js"))).toBe(false);
  });
});
