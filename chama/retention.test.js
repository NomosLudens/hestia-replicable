import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs";
import { tmpdir } from "node:os";
import { sweepOldData, RETENTION, resolveRetention } from "./retention.js";

async function makeTmpDir(prefix) {
  return new Promise((resolve, reject) =>
    mkdtemp(join(tmpdir(), prefix), (err, dir) => (err ? reject(err) : resolve(dir))),
  );
}

async function touchWithMtime(filePath, mtimeMs) {
  await fs.writeFile(filePath, "conteudo");
  const date = new Date(mtimeMs);
  await fs.utimes(filePath, date, date);
}

describe("sweepOldData", () => {
  let dataDir;
  const now = Date.now();

  beforeEach(async () => {
    dataDir = await makeTmpDir("hestia-retention-");
    await fs.mkdir(join(dataDir, "organizer", "plans"), { recursive: true });
    await fs.mkdir(join(dataDir, "organizer", "runs"), { recursive: true });
    await fs.mkdir(join(dataDir, "events"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch {
      // Ignora erro ao limpar
    }
  });

  it("remove arquivo de plano mais velho que o limite, mantém o recente", async () => {
    const oldPlan = join(dataDir, "organizer", "plans", "plan_old.json");
    const newPlan = join(dataDir, "organizer", "plans", "plan_new.json");
    await touchWithMtime(oldPlan, now - RETENTION.plansMaxAgeMs - 1000);
    await touchWithMtime(newPlan, now - 1000);

    const result = await sweepOldData(dataDir, RETENTION, now);

    expect(result.plansRemoved).toBe(1);
    await expect(fs.access(oldPlan)).rejects.toThrow();
    await expect(fs.access(newPlan)).resolves.toBeUndefined();
  });

  it("remove execução mais velha que o limite (90 dias), mantém a recente", async () => {
    const oldRun = join(dataDir, "organizer", "runs", "org_old.json");
    const newRun = join(dataDir, "organizer", "runs", "org_new.json");
    await touchWithMtime(oldRun, now - RETENTION.runsMaxAgeMs - 1000);
    await touchWithMtime(newRun, now - 1000);

    const result = await sweepOldData(dataDir, RETENTION, now);

    expect(result.runsRemoved).toBe(1);
    await expect(fs.access(oldRun)).rejects.toThrow();
    await expect(fs.access(newRun)).resolves.toBeUndefined();
  });

  it("remove evento mais velho que o limite (30 dias), mantém o recente", async () => {
    const oldEvent = join(dataDir, "events", "events-2020-01-01.jsonl");
    const newEvent = join(dataDir, "events", "events-2020-02-01.jsonl");
    await touchWithMtime(oldEvent, now - RETENTION.eventsMaxAgeMs - 1000);
    await touchWithMtime(newEvent, now - 1000);

    const result = await sweepOldData(dataDir, RETENTION, now);

    expect(result.eventsRemoved).toBe(1);
    await expect(fs.access(oldEvent)).rejects.toThrow();
    await expect(fs.access(newEvent)).resolves.toBeUndefined();
  });

  it("não lança se os diretórios ainda não existirem", async () => {
    const freshDataDir = await makeTmpDir("hestia-retention-fresh-");
    const result = await sweepOldData(freshDataDir, RETENTION, now);
    expect(result).toEqual({ plansRemoved: 0, runsRemoved: 0, eventsRemoved: 0 });
    await fs.rm(freshDataDir, { recursive: true, force: true });
  });

  it("respeita limites diferentes por categoria (plano expira antes da execução)", async () => {
    const midAgeMs = now - RETENTION.plansMaxAgeMs - 1000; // expirou pra plano, não pra execução
    const plan = join(dataDir, "organizer", "plans", "plan_midage.json");
    const run = join(dataDir, "organizer", "runs", "org_midage.json");
    await touchWithMtime(plan, midAgeMs);
    await touchWithMtime(run, midAgeMs);

    const result = await sweepOldData(dataDir, RETENTION, now);

    expect(result.plansRemoved).toBe(1);
    expect(result.runsRemoved).toBe(0);
    await expect(fs.access(run)).resolves.toBeUndefined();
  });
});

describe("resolveRetention", () => {
  it("usa os defaults quando nenhuma env var está setada", () => {
    expect(resolveRetention({})).toEqual(RETENTION);
  });

  it("aceita override por dias via env, uma categoria de cada vez", () => {
    const r = resolveRetention({ HESTIA_RETENTION_PLANS_DAYS: "14" });
    expect(r.plansMaxAgeMs).toBe(14 * 24 * 60 * 60 * 1000);
    expect(r.runsMaxAgeMs).toBe(RETENTION.runsMaxAgeMs);
    expect(r.eventsMaxAgeMs).toBe(RETENTION.eventsMaxAgeMs);
  });

  it("aceita override das três categorias ao mesmo tempo", () => {
    const r = resolveRetention({
      HESTIA_RETENTION_PLANS_DAYS: "1",
      HESTIA_RETENTION_RUNS_DAYS: "30",
      HESTIA_RETENTION_EVENTS_DAYS: "7",
    });
    expect(r.plansMaxAgeMs).toBe(1 * 24 * 60 * 60 * 1000);
    expect(r.runsMaxAgeMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(r.eventsMaxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("ignora valor inválido (não-numérico, zero, negativo) e cai no default", () => {
    expect(resolveRetention({ HESTIA_RETENTION_PLANS_DAYS: "abc" }).plansMaxAgeMs).toBe(
      RETENTION.plansMaxAgeMs,
    );
    expect(resolveRetention({ HESTIA_RETENTION_PLANS_DAYS: "0" }).plansMaxAgeMs).toBe(
      RETENTION.plansMaxAgeMs,
    );
    expect(resolveRetention({ HESTIA_RETENTION_PLANS_DAYS: "-5" }).plansMaxAgeMs).toBe(
      RETENTION.plansMaxAgeMs,
    );
  });
});
