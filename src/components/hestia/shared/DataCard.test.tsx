import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataCard } from "./DataCard";

describe("DataCard", () => {
  afterEach(() => cleanup());

  it("does not crash with external status unavailable", () => {
    render(
      <DataCard title="Serviço" status="unavailable">
        <span>conteúdo real</span>
      </DataCard>,
    );
    expect(screen.getByRole("button", { name: /serviço/i })).toBeTruthy();
    expect(screen.getByLabelText("status: desconectado")).toBeTruthy();
  });

  it("does not crash with external status critical", () => {
    render(
      <DataCard title="Serviço" status="critical">
        <span>conteúdo real</span>
      </DataCard>,
    );
    expect(screen.getByRole("button", { name: /serviço/i })).toBeTruthy();
    expect(screen.getByLabelText("status: crítico")).toBeTruthy();
  });

  it("falls back safely with unknown status", () => {
    render(
      <DataCard title="Serviço" status="random_unknown_status">
        <span>conteúdo real</span>
      </DataCard>,
    );
    expect(screen.getByRole("button", { name: /serviço/i })).toBeTruthy();
    expect(screen.getByLabelText("status: informativo")).toBeTruthy();
  });
});
