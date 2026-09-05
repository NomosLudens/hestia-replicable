import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATE_GLOSSARY,
  CATEGORY_LABEL,
  EVENT_GLOSSARY,
  SERVICE_GLOSSARY,
  UNIT_FILE_STATE_GLOSSARY,
  describeService,
  findEventEntry,
  findServiceEntry,
} from "./glossary";

describe("describeService", () => {
  it("usa entrada curada quando a unit casa exatamente", () => {
    const r = describeService("tailscaled.service", "Tailscale node agent");
    expect(r.title).toBe("tailscaled");
    expect(r.description).toMatch(/Tailscale/);
  });

  it("usa entrada curada via prefixo user@ para user@1000.service", () => {
    const r = describeService("user@1000.service", "User Manager for UID 1000");
    expect(r.title).toBe("user@.service");
    expect(r.description).toMatch(/user@<uid>\.service/);
  });

  it("cai na Description do systemd quando não há match", () => {
    const r = describeService("kkk-weird.service", "Some Custom Service");
    expect(r.title).toBe("kkk-weird.service");
    expect(r.description).toBe("Some Custom Service");
  });

  it("cai no fallback genérico quando a Description é vazia ou igual ao nome", () => {
    const r = describeService("kkk-weird.service", "");
    expect(r.description).toMatch(/Sem descrição adicional conhecida/);
  });
});

describe("findServiceEntry", () => {
  it("encontra entradas conhecidas", () => {
    expect(findServiceEntry("hestia-station-agent.service")).not.toBeNull();
    expect(findServiceEntry("tor.service")).not.toBeNull();
    expect(findServiceEntry("yggdrasil.service")).not.toBeNull();
    expect(findServiceEntry("blackbox.service")).not.toBeNull();
    expect(findServiceEntry("witness.service")).not.toBeNull();
  });

  it("devolve null para serviços fora do glossário", () => {
    expect(findServiceEntry("kkk-12345.service")).toBeNull();
  });
});

describe("findEventEntry", () => {
  it("cobre os eventos do Guardião", () => {
    expect(findEventEntry("wake.requested")).not.toBeNull();
    expect(findEventEntry("station.note.down")).not.toBeNull();
    expect(findEventEntry("station.mini.up")).not.toBeNull();
    expect(findEventEntry("service.jellyfin.down")).not.toBeNull();
  });

  it("devolve null para eventos fora do glossário", () => {
    expect(findEventEntry("algum.evento.desconhecido")).toBeNull();
  });
});

describe("consistência dos glossários", () => {
  it("ServiceGlossary não tem duplicatas de match", () => {
    const matches = new Set<string>();
    for (const e of SERVICE_GLOSSARY) {
      expect(matches.has(e.match), `duplicate match=${e.match}`).toBe(false);
      matches.add(e.match);
    }
  });

  it("ACTIVE_STATE_GLOSSARY cobre os activeStates canônicos do systemd", () => {
    const allowed = new Set([
      "active",
      "inactive",
      "failed",
      "activating",
      "deactivating",
      "reloading",
      "maintenance",
      "unknown",
    ]);
    for (const s of allowed) {
      const hit = ACTIVE_STATE_GLOSSARY.find((g) => g.state === s);
      expect(hit, `activeState ${s} missing from glossary`).toBeDefined();
    }
  });

  it("UNIT_FILE_STATE_GLOSSARY cobre os unitFileStates canônicos do systemd (exceto 'unknown', tratado pelo fallback)", () => {
    const allowed = new Set([
      "enabled",
      "disabled",
      "static",
      "masked",
      "generated",
      "transient",
      "bad",
      "indirect",
    ]);
    for (const s of allowed) {
      const hit = UNIT_FILE_STATE_GLOSSARY.find((g) => g.state === s);
      expect(hit, `unitFileState ${s} missing from glossary`).toBeDefined();
    }
  });

  it("CATEGORY_LABEL mapeia todas as categorias usadas em SERVICE_GLOSSARY", () => {
    const used = new Set(SERVICE_GLOSSARY.map((e) => e.category));
    for (const c of used) {
      expect(CATEGORY_LABEL[c], `category ${c} missing label`).toBeDefined();
    }
  });

  it("EVENT_GLOSSARY tem entradas para os principais tipos do Guardião", () => {
    const types = [
      "wake.requested",
      "station.X.up",
      "station.X.down",
      "service.X.up",
      "service.X.down",
    ];
    for (const t of types) {
      const found = EVENT_GLOSSARY.some(
        (e) => e.match === t || e.match.startsWith(t.replace("X.", "")),
      );
      expect(found, `event type ${t} missing from glossary`).toBe(true);
    }
  });

  it("descreve wake como solicitação encaminhada ao executor", () => {
    const wake = findEventEntry("wake.requested");
    expect(wake?.detail).toContain("executor configurado");
    expect(wake?.detail).not.toContain("O Console transmitiu");
  });
});
