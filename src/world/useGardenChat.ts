import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { playSound } from '@/audio/sound';
import { supabase } from '@/lib/supabase';

export const MAX_SAY = 80;
const MIN_GAP_MS = 1500;

export type Bubble = { id: number; text: string; ttl: number };

/** Longer messages stay up a little longer: 4–10 s. */
const ttlFor = (text: string) => Math.min(10_000, 4_000 + text.length * 60);

let nextId = 1;

/**
 * Club Penguin-style chat for the garden. Everyone speaks on their own private
 * Realtime channel ("garden:<username>") and listens to their friends'; the RLS
 * policies in 0002_game.sql enforce both. Nothing is stored: if you're not in
 * the garden when someone speaks, you don't see it.
 */
export function useGardenChat(me: string, friends: string[]) {
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const mine = useRef<RealtimeChannel | null>(null);
  const lastSaid = useRef(0);
  const friendKey = friends.join(',');

  const show = useCallback((username: string, text: string) => {
    const bubble = { id: nextId++, text: text.slice(0, MAX_SAY), ttl: ttlFor(text) };
    setBubbles((b) => ({ ...b, [username]: bubble }));
    setTimeout(() => {
      setBubbles((b) => (b[username]?.id === bubble.id ? omit(b, username) : b));
    }, bubble.ttl);
  }, []);

  useEffect(() => {
    const topics = [me, ...(friendKey ? friendKey.split(',') : [])];
    const channels = topics.map((username) => {
      const channel = supabase.channel(`garden:${username}`, { config: { private: true } });
      if (username !== me) {
        channel.on('broadcast', { event: 'say' }, ({ payload }) => {
          if (typeof payload?.text !== 'string') return;
          show(username, payload.text);
          playSound('pop');
        });
      }
      channel.subscribe();
      return channel;
    });
    mine.current = channels[0];
    return () => {
      mine.current = null;
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [me, friendKey, show]);

  /** Says something; returns false if it was empty or too soon after the last. */
  const say = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, MAX_SAY);
      if (!text || Date.now() - lastSaid.current < MIN_GAP_MS) return false;
      lastSaid.current = Date.now();
      mine.current?.send({ type: 'broadcast', event: 'say', payload: { text } });
      show(me, text);
      playSound('pop');
      return true;
    },
    [me, show]
  );

  return { bubbles, say };
}

function omit<T>(record: Record<string, T>, key: string) {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
