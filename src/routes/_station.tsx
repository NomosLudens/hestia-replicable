import { Outlet, createFileRoute } from "@tanstack/react-router";
import { StationShell } from "@/components/kaline/StationShell";

export const Route = createFileRoute("/_station")({
  component: () => (
    <StationShell>
      <Outlet />
    </StationShell>
  ),
});
