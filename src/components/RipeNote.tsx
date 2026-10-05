import { useNow } from '@/hooks/useNow';
import type { Me } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { formatSpan } from '@/lib/time';
import { Muted } from './Chrome';

/**
 * "Your radishes are ripe: pick them within 2 days." Crops ripen as sessions
 * end, and wither if they're left, so the payout and the car park say so.
 */
export function RipeNote({ ripe, style }: { ripe: Me['ripe']; style?: object }) {
  const now = useNow(60_000);
  if (!ripe || ripe.length === 0) return null;
  const names = [
    ...new Set(ripe.map((r) => (itemInfo(r.crop).plural ?? itemInfo(r.crop).name).toLowerCase())),
  ];
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const soonest = ripe
    .map((r) => (r.withers_at ? Date.parse(r.withers_at) : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  const left = Number.isFinite(soonest) ? `: pick them within ${formatSpan(soonest - now)}` : '';
  return <Muted style={style}>{`Your ${list} are ripe${left}.`}</Muted>;
}
