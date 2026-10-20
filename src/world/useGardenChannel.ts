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
  /** A friend moved (or told us where they are, and whether they're sitting on a bench). */
  onMove: (username: string, at: Point, sitting: boolean) => void;
  /**
   * You moved on another device (or it said where you are). `walking` means
   * someone's steering you there.
   */
  onSelf: (at: Point, sitting: boolean, walking: boolean) => void;
  /** A rift opened at `at`: between your own devices, or a friend's. */
  onRift: (username: string, at: Point) => void;
  /** Where you are, to answer a friend who's just come into the garden. */
  where: () => Point;
  /** Whether you're sitting on a bench. */
  sitting: () => boolean;
  /** Whether you're being steered on this device. */
  steering: () => boolean;
};

const isPoint = (
  p: { x?: unknown; y?: unknown } | undefined
): p is Point & Record<string, unknown> => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/**
 * The garden's live link: who's in it, where they're standing, and
 * Club Penguin-style chat bubbles. Everyone has two private Realtime channels:
 * "garden:<username>", where they are, which friends and friends of friends
 * hear; and "garden-chat:<username>", what they say, which only friends hear.
 * Everyone speaks only on their own; the RLS policies in
 * 0014_circles_and_last_active.sql enforce all that. Nothing is stored: if
 * you're not in the garden when someone speaks, you don't see it.
 *
 * Events on "garden:": "hello" (just arrived: say where you are), "pos" {x, y,
 * sit?, walk?, new?}, "rift" {x, y} and "bye" (left the garden). On
 * "garden-chat:": "say" {text}.
 *
 * You can be in the garden on more than one device at once. They listen on
 * your own channel too, and keep to one position: whichever is being steered
 * leads, and the rest follow. A device that's just arrived marks its first
 * position "new", and the others answer with where you really are. If two
 * are steered apart at once, a rift opens (see the garden).
 */
export function useGardenChannel(
  me: string,
  friends: string[],
  /** Friends of friends in the garden: you see them walk, but don't hear them talk. */
  others: string[],
  enabled: boolean,
  handlers: Handlers
) {
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  /** Friends who are in the garden right now, as far as we've heard. */
  const [present, setPresent] = useState<string[]>([]);
  const heard = useRef(new Map<string, number>());
  const mine = useRef<RealtimeChannel | null>(null);
  const myChat = useRef<RealtimeChannel | null>(null);
  /** True once your own channel is joined and can carry messages. */
  const ready = useRef(false);
  const lastSaid = useRef(0);
  const sentAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendKey = friends.join(',');
  const othersKey = others.join(',');
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

  const sendPos = useCallback((arriving = false) => {
    if (!ready.current) return;
    const at = on.current.where();
    sentAt.current = Date.now();
    mine.current?.send({
      type: 'broadcast',
      event: 'pos',
      payload: {
        x: Math.round(at.x),
        y: Math.round(at.y),
        ...(on.current.sitting() && { sit: 1 }),
        ...(on.current.steering() && { walk: 1 }),
        ...(arriving && { new: 1 }),
      },
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const listening = heard.current;
    const friendList = friendKey ? friendKey.split(',') : [];
    const walkers = [me, ...friendList, ...(othersKey ? othersKey.split(',') : [])];
    const talkers = [me, ...friendList];
    let settled = 0;
    let greeted = false;
    // Once we're listening everywhere, say hello so friends say where they are.
    const greet = () => {
      if (greeted || !ready.current) return;
      greeted = true;
      mine.current?.send({ type: 'broadcast', event: 'hello', payload: {} });
      sendPos(true);
    };
    const where = walkers.map((username) => {
      const channel = supabase.channel(`garden:${username}`, { config: { private: true } });
      // Your other devices. (Nothing you send here comes back to this one.)
      if (username === me) {
        channel
          .on('broadcast', { event: 'pos' }, ({ payload }) => {
            if (!isPoint(payload)) return;
            // Just arrived there: this device knows better, so say where you are.
            if (payload.new === 1) return sendPos();
            on.current.onSelf(
              clampToGarden({ x: payload.x, y: payload.y }),
              payload.sit === 1,
              payload.walk === 1
            );
          })
          .on('broadcast', { event: 'rift' }, ({ payload }) => {
            if (isPoint(payload)) on.current.onRift(me, { x: payload.x, y: payload.y });
          });
      } else {
        channel
          .on('broadcast', { event: 'pos' }, ({ payload }) => {
            if (!Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return;
            on.current.onMove(
              username,
              clampToGarden({ x: payload.x, y: payload.y }),
              payload.sit === 1
            );
            hear(username);
          })
          .on('broadcast', { event: 'hello' }, () => sendPos())
          .on('broadcast', { event: 'rift' }, ({ payload }) => {
            if (isPoint(payload)) on.current.onRift(username, { x: payload.x, y: payload.y });
          })
          .on('broadcast', { event: 'bye' }, () => {
            if (heard.current.delete(username)) publishPresent();
          });
      }
      return channel;
    });
    // What you and your friends say, on each one's chat channel (yours from your other devices too).
    const said = talkers.map((username) =>
      supabase
        .channel(`garden-chat:${username}`, { config: { private: true } })
        .on('broadcast', { event: 'say' }, ({ payload }) => {
          if (typeof payload?.text !== 'string') return;
          if (username !== me) hear(username);
          show(username, payload.text);
          playSound('pop');
        })
    );
    const channels = [...where, ...said];
    channels.forEach((channel, i) =>
      channel.subscribe((status) => {
        if (i === 0 && status === 'SUBSCRIBED') ready.current = true;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled += 1;
          if (settled >= channels.length) greet();
        }
      })
    );
    mine.current = where[0];
    myChat.current = said[0];
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
      myChat.current = null;
      channels.forEach((c) => supabase.removeChannel(c));
      listening.clear();
      publishPresent();
    };
  }, [me, friendKey, othersKey, enabled, show, hear, publishPresent, sendPos]);

  /** Says something; returns false if it was empty or too soon after the last. */
  const say = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, MAX_SAY);
      if (!text || Date.now() - lastSaid.current < MIN_GAP_MS) return false;
      lastSaid.current = Date.now();
      myChat.current?.send({ type: 'broadcast', event: 'say', payload: { text } });
      show(me, text);
      playSound('pop');
      return true;
    },
    [me, show]
  );

  /** Your devices disagree: a rift opens at `at`, for them and your friends to see. */
  const rift = useCallback((at: Point) => {
    mine.current?.send({
      type: 'broadcast',
      event: 'rift',
      payload: { x: Math.round(at.x), y: Math.round(at.y) },
    });
  }, []);

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

  return { bubbles, present, say, moved, rift };
}

function omit<T>(record: Record<string, T>, key: string) {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
