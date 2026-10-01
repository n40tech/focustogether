import { useEffect, useState } from 'react';

import { serverNow } from '@/lib/clock';
import { conditionsAt, type Conditions } from './conditions';

/** The shared weather and your local light, recomputed every `everyMs`. */
export function useConditions(everyMs = 15_000): Conditions {
  const [conditions, setConditions] = useState(() => conditionsAt(serverNow()));
  useEffect(() => {
    const id = setInterval(() => setConditions(conditionsAt(serverNow())), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return conditions;
}
