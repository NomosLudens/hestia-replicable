import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiState } from "./api";

/**
 * Executa `fn` no mount e sempre que `deps` mudarem.
 * Expõe `retry()` para reexecutar manualmente a chamada e atualizar `state`
 * com o novo resultado. Durante um retry manual, `refreshing` fica true e
 * o `state` anterior é preservado (não volta para "loading"), evitando piscar.
 */
export function useApi<T>(
  fn: () => Promise<ApiState<T>>,
  deps: React.DependencyList = [],
): { state: ApiState<T>; retry: () => void; refreshing: boolean } {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const aliveRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback((manual: boolean) => {
    if (manual) setRefreshing(true);
    else setState({ status: "loading" });
    fnRef.current().then((s) => {
      if (!aliveRef.current) return;
      setState(s);
      if (manual) setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    run(false);
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const retry = useCallback(() => run(true), [run]);
  return { state, retry, refreshing };
}
