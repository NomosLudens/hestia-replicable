import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiState } from "./api";

export function usePollingApi<T>(
  fetcher: () => Promise<ApiState<T>>,
  intervalMs = 5000,
  enabled = true,
) {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(async () => {
    if (!enabled || busy.current || document.visibilityState === "hidden") return;
    busy.current = true;
    setRefreshing((s) => state.status === "ok" || s);
    const next = await fetcher();
    setState((prev) => (next.status === "loading" ? prev : next));
    if (next.status === "ok") setLastUpdated(next.fetchedAt);
    setRefreshing(false);
    busy.current = false;
  }, [enabled, fetcher, state.status]);
  useEffect(() => {
    void run();
    const id = window.setInterval(run, Math.max(5000, intervalMs));
    return () => clearInterval(id);
  }, [run, intervalMs]);
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [run]);
  return { state, retry: run, refreshing, lastUpdated };
}
