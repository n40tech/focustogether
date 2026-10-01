import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Fetches on mount, every `intervalMs` while the app is in the foreground,
 * and again whenever the app returns to the foreground.
 * `fetcher` should be a stable function (e.g. from `api`).
 */
export function usePolled<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [fetcher]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      refresh();
      timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop()
    );
    return () => {
      stop();
      sub.remove();
    };
  }, [refresh, intervalMs]);

  return { data, setData, error, refresh };
}
