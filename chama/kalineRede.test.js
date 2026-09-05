import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "rede", "index.html"),
  "utf8",
);
const STORAGE_KEY = "kaline-rede.config.v1";
const windows = [];

function load(config = {}) {
  const open = vi.fn();
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://hestia.example/rede/",
    beforeParse(window) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      window.open = open;
      window.requestAnimationFrame = (callback) => callback();
    },
  });
  windows.push(dom.window);
  return { window: dom.window, document: dom.window.document, open };
}

function buttonIn(document, selector, label) {
  return [...document.querySelectorAll(`${selector} button`)].find((button) =>
    button.textContent.includes(label),
  );
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
  vi.restoreAllMocks();
});

describe("Kaline Rede", () => {
  it("abre Servidor e TV Box na Console e Histórico em /historico", () => {
    const { document, open } = load({ "note.hestia": "https://console.example" });
    buttonIn(document, '[aria-label="Servidor"]', "Abrir na Héstia").click();
    buttonIn(document, '[aria-label="TV Box"]', "Abrir na Héstia").click();
    buttonIn(document, "#quick-grid", "Abrir").click();
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      "https://console.example/",
      "https://console.example/",
      "https://console.example/",
    ]);
    const historico = [...document.querySelectorAll("#quick-grid .qa")].find((item) =>
      item.textContent.includes("Histórico"),
    );
    historico.querySelector("button").click();
    expect(open).toHaveBeenLastCalledWith(
      "https://console.example/historico",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("abre somente a URL configurada do Códice Web App independente", () => {
    const { document, open } = load({
      "note.hestia": "https://console.example",
      "tv.codice": "https://codice.example/app",
    });
    buttonIn(document, '[aria-label="TV Box"]', "Códice Web App").click();
    expect(open).toHaveBeenCalledWith(
      "https://codice.example/app",
      "_blank",
      "noopener,noreferrer",
    );
    expect(open.mock.calls.map(([url]) => url)).not.toContain("https://console.example/codice");
  });

  it("desativa o Códice vazio com orientação específica", () => {
    const { document } = load({ "note.hestia": "https://console.example" });
    const button = buttonIn(document, '[aria-label="TV Box"]', "Configure o Códice Web App");
    expect(button.disabled).toBe(true);
  });

  it.each(["/api/", "/api/codice/health", "/api/codice/library", "/api/codice/books/exemplo"])(
    "rejeita Códice configurado como endpoint protegido: %s",
    (path) => {
      const { document, window } = load({ "note.hestia": "https://console.example" });
      const input = document.querySelector('[data-cfg="tv.codice"]');
      input.value = `https://station.example${path}`;
      document.getElementById("btn-save").click();
      expect(document.querySelector('[data-err="tv.codice"]').textContent).toContain(
        "não uma rota de API",
      );
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      expect(saved["tv.codice"]).toBeUndefined();
    },
  );

  it("preserva somente campos conhecidos no STORAGE_KEY existente", () => {
    const { document } = load({
      "note.hestia": "https://console.example",
      "tv.codice": "https://codice.example",
      authorization: "não deve ser carregado",
    });
    expect(document.querySelector('[data-cfg="note.hestia"]').value).toBe(
      "https://console.example",
    );
    expect(document.querySelector('[data-cfg="tv.codice"]').value).toBe("https://codice.example");
    expect(document.body.textContent).not.toContain("não deve ser carregado");
  });
});
