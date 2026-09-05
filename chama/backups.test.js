import { describe, it, expect } from "vitest";
import { getBackupsPlan } from "./backups.js";

describe("getBackupsPlan", () => {
  it("retorna status 'planned' (stub honesto)", () => {
    const plan = getBackupsPlan();
    expect(plan.status).toBe("planned");
  });

  it("retorna jobs vazios (nenhum backup real ainda)", () => {
    const plan = getBackupsPlan();
    expect(Array.isArray(plan.jobs)).toBe(true);
    expect(plan.jobs.length).toBe(0);
  });

  it("retorna lastRun como null", () => {
    const plan = getBackupsPlan();
    expect(plan.lastRun).toBeNull();
  });

  it("sempre retorna o mesmo objeto estrutural", () => {
    const p1 = getBackupsPlan();
    const p2 = getBackupsPlan();
    expect(p1.status).toBe(p2.status);
    expect(p1.jobs.length).toBe(p2.jobs.length);
  });
});
