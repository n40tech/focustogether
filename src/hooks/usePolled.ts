import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Fetches on mount, every `intervalMs` while the app is in the foreground,
 * and again whenever the app returns to the foreground.
 * `fetcher` should be a stable function (e.g. from `api`).
 *
 * A fetch that comes back after something newer (a later fetch, or `setData`
 * with the result of an action, like going home) is dropped, so a poll that
 * was already on its way can't undo what you just did.
 */
export function usePolled<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setFresh] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const setData = useCallback((value: T) => {
    latest.current += 1;
    setFresh(value);
  }, []);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await fetcher();
      if (ticket === latest.current) {
        setFresh(result);
        setError(null);
      }
      return result;
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof Error ? e.message : String(e));
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
