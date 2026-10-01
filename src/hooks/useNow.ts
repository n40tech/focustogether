import { useEffect, useState } from 'react';

import { serverNow } from '@/lib/clock';

/** Current (server-corrected) time in ms, re-rendering every `tickMs`. */
export function useNow(tickMs = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}
