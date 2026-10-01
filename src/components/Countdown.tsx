import { useEffect } from 'react';
import { Text, type TextStyle } from 'react-native';

import { useNow } from '@/hooks/useNow';
import { formatCountdown, formatMinutes } from '@/lib/time';

/**
 * Time left until `until` (server clock), ticking on its own so the scene
 * around it doesn't re-render every second. Calls `onDone` once it reaches 0.
 */
export function Countdown({
  until,
  style,
  minutes,
  onDone,
}: {
  until: string;
  style?: TextStyle | TextStyle[];
  /** "4m" instead of "03:59". */
  minutes?: boolean;
  onDone?: () => void;
}) {
  const now = useNow(minutes ? 15_000 : 1000);
  const left = Date.parse(until) - now;
  const done = left <= 0;
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);
  return (
    <Text style={style} accessibilityRole="timer">
      {minutes ? formatMinutes(left) : formatCountdown(left)}
    </Text>
  );
}
