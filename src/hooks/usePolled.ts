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
 *
 * Most polls bring back just what we had (bar the server's clock), so those
 * change nothing: redrawing a whole place for nothing makes it stutter.
 */
export function usePolled<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setFresh] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  /** What we have, as text, to tell whether a poll brought anything new. */
  const held = useRef<string | null>(null);

  const setData = useCallback((value: T) => {
    latest.current += 1;
    held.current = null;
    setFresh(value);
  }, []);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await fetcher();
      if (ticket === latest.current) {
        const text = sameness(result);
        if (text !== held.current) {
          held.current = text;
          setFresh(result);
        }
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

/** A value as text, leaving out the server's clock, which changes every time. */
const sameness = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === 'server_now' ? undefined : v));
