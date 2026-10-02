import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { playSound } from '@/audio/sound';
import { supabase } from '@/lib/supabase';
import { clampToGarden, type Point } from './gardenMap';

export const MAX_SAY = 80;
const MIN_GAP_MS = 1500;
/** Positions go out at most this often while you walk; friends' clients ease between them. */
export const POS_EVERY_MS = 200;
/** Standing still, you still say where you are this often... */
const HEARTBEAT_MS = 20_000;
/** ...and a friend not heard from for this long has gone (closed the app, lost signal). */
const GONE_AFTER_MS = 50_000;

export type Bubble = { id: number; text: string; ttl: number };

/** Longer messages stay up a little longer: 4–10 s. */
const ttlFor = (text: string) => Math.min(10_000, 4_000 + text.length * 60);

let nextId = 1;

type Handlers = {
  /** A friend moved (or told us where they are). */
  onMove: (username: string, at: Point) => void;
  /** Where you are, to answer a friend who's just come into the garden. */
  where: () => Point;
};

/**
 * The garden's live link: who's in it, where they're standing, and
 * Club Penguin-style chat bubbles. Everyone speaks on their own private
 * Realtime channel ("garden:<username>") and listens to their friends'; the RLS
 * policies in 0002_game.sql enforce both. Nothing is stored: if you're not in
 * the garden when someone speaks, you don't see it.
 *
 * Events: "hello" (just arrived: say where you are), "pos" {x, y}, "say"
 * {text} and "bye" (left the garden).
 */
export function useGardenChannel(
  me: string,
  friends: string[],
  enabled: boolean,
  handlers: Handlers
) {
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  /** Friends who are in the garden right now, as far as we've heard. */
  const [present, setPresent] = useState<string[]>([]);
  const heard = useRef(new Map<string, number>());
  const mine = useRef<RealtimeChannel | null>(null);
  /** True once your own channel is joined and can carry messages. */
  const ready = useRef(false);
  const lastSaid = useRef(0);
  const sentAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendKey = friends.join(',');
  const on = useRef(handlers);
  useEffect(() => {
    on.current = handlers;
  });

  const show = useCallback((username: string, text: string) => {
    const bubble = { id: nextId++, text: text.slice(0, MAX_SAY), ttl: ttlFor(text) };
    setBubbles((b) => ({ ...b, [username]: bubble }));
    setTimeout(() => {
      setBubbles((b) => (b[username]?.id === bubble.id ? omit(b, username) : b));
    }, bubble.ttl);
  }, []);

  const publishPresent = useCallback(() => setPresent([...heard.current.keys()].sort()), []);

  const hear = useCallback(
    (username: string) => {
      const known = heard.current.has(username);
      heard.current.set(username, Date.now());
      if (!known) publishPresent();
    },
    [publishPresent]
  );

  const sendPos = useCallback(() => {
    if (!ready.current) return;
    const at = on.current.where();
    sentAt.current = Date.now();
    mine.current?.send({
      type: 'broadcast',
      event: 'pos',
      payload: { x: Math.round(at.x), y: Math.round(at.y) },
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const listening = heard.current;
    const topics = [me, ...(friendKey ? friendKey.split(',') : [])];
    let settled = 0;
    let greeted = false;
    // Once we're listening everywhere, say hello so friends say where they are.
    const greet = () => {
      if (greeted || !ready.current) return;
      greeted = true;
      mine.current?.send({ type: 'broadcast', event: 'hello', payload: {} });
      sendPos();
    };
    const channels = topics.map((username) => {
      const channel = supabase.channel(`garden:${username}`, { config: { private: true } });
      if (username !== me) {
        channel
          .on('broadcast', { event: 'say' }, ({ payload }) => {
            if (typeof payload?.text !== 'string') return;
            hear(username);
            show(username, payload.text);
            playSound('pop');
          })
          .on('broadcast', { event: 'pos' }, ({ payload }) => {
            if (!Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return;
            on.current.onMove(username, clampToGarden({ x: payload.x, y: payload.y }));
            hear(username);
          })
          .on('broadcast', { event: 'hello' }, () => sendPos())
          .on('broadcast', { event: 'bye' }, () => {
            if (heard.current.delete(username)) publishPresent();
          });
      }
      channel.subscribe((status) => {
        if (username === me && status === 'SUBSCRIBED') ready.current = true;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled += 1;
          if (settled >= topics.length) greet();
        }
      });
      return channel;
    });
    mine.current = channels[0];
    // Don't wait forever on a friend's channel that won't join.
    const fallback = setTimeout(greet, 4000);
    const heartbeat = setInterval(sendPos, HEARTBEAT_MS);
    const sweep = setInterval(() => {
      const cutoff = Date.now() - GONE_AFTER_MS;
      let changed = false;
      heard.current.forEach((at, username) => {
        if (at < cutoff) changed = heard.current.delete(username) || changed;
      });
      if (changed) publishPresent();
    }, 5000);
    return () => {
      clearTimeout(fallback);
      clearInterval(heartbeat);
      clearInterval(sweep);
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      if (ready.current) mine.current?.send({ type: 'broadcast', event: 'bye', payload: {} });
      ready.current = false;
      mine.current = null;
      channels.forEach((c) => supabase.removeChannel(c));
      listening.clear();
      publishPresent();
    };
  }, [me, friendKey, enabled, show, hear, publishPresent, sendPos]);

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

  /** You moved: tell friends, no more often than POS_EVERY_MS (always ending where you stopped). */
  const moved = useCallback(() => {
    if (pending.current) return;
    const wait = sentAt.current + POS_EVERY_MS - Date.now();
    if (wait <= 0) return sendPos();
    pending.current = setTimeout(() => {
      pending.current = null;
      sendPos();
    }, wait);
  }, [sendPos]);

  return { bubbles, present, say, moved };
}

function omit<T>(record: Record<string, T>, key: string) {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
