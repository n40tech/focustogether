import { AppState, Platform } from 'react-native';

import { api, type Me } from './api';
import { serverNow } from './clock';
import { rpcKeepalive } from './supabase';

/**
 * Focus means staying on the page: a session stops if the page it was
 * started on is left for more than AWAY_GRACE_S. On a phone or tablet, hiding
 * the page counts (another app, another tab, the phone locked). On a computer,
 * other tabs and windows are fine, for notes and reading: only leaving the
 * page itself counts (closing its tab, or going to another site in it). This
 * page tells the server the moment it's left, and on coming back says how
 * long it was away, in case that first word never got through. Meanwhile it
 * keeps the screen awake, so the phone doesn't lock by itself mid-session.
 */

const web = Platform.OS === 'web' && typeof document !== 'undefined';
const PAGE_KEY = 'focus.page';
const AWAY_KEY = 'focus.away';

/**
 * True on a computer (its main pointer is a mouse or trackpad), where other
 * tabs and windows are fine mid-session. Asked each time, as a tablet can
 * gain or lose a trackpad.
 */
export const otherTabsAllowed = () =>
  web &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const newId = () => `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

function stored(key: string) {
  try {
    return web ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (!web) return;
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private browsing can refuse storage; memory is enough then.
  }
}

/**
 * This page's id. A browser tab keeps its own, across reloads; each launch of
 * the app gets a new one.
 */
export const pageId = (() => {
  const saved = stored(PAGE_KEY);
  if (saved) return saved;
  const id = newId();
  store(PAGE_KEY, id);
  return id;
})();

type Away = { session: number; at: number };

/** The session started on this page, while it runs. */
let watching: { session: number; endsAt: number } | null = null;
/** When this page was hidden mid-session, until the server's been told we're back. */
let away: Away | null = (() => {
  try {
    const raw = stored(AWAY_KEY);
    return raw ? (JSON.parse(raw) as Away) : null;
  } catch {
    return null;
  }
})();
/** Telling the server we've gone: wait for it before saying we're back. */
let leaving: Promise<unknown> | null = null;

function hidden() {
  if (!watching || serverNow() >= watching.endsAt || away) return;
  away = { session: watching.session, at: Date.now() };
  store(AWAY_KEY, JSON.stringify(away));
  const args = { p_session: watching.session, p_device: pageId };
  leaving = web ? rpcKeepalive('leave_page', args) : api.leavePage(watching.session, pageId);
}

const showing = () =>
  web ? document.visibilityState === 'visible' : AppState.currentState === 'active';

/**
 * Fetches you: as `get_me`, unless this page has just come back from being
 * hidden mid-session, when the server hears how long it was away first.
 */
export async function fetchMe(): Promise<Me> {
  if (away && showing()) {
    const report = away;
    away = null;
    store(AWAY_KEY, null);
    if (leaving) {
      await Promise.race([leaving.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      leaving = null;
    }
    const seconds = Math.max(0, Math.round((Date.now() - report.at) / 1000));
    return api.backToPage(report.session, pageId, seconds);
  }
  return api.getMe();
}

// --- keeping the screen on ----------------------------------------------------

type Sentinel = { release: () => Promise<void> };
let lock: Sentinel | null = null;
let wanting = false;

async function holdScreen() {
  const want = web && !!watching && showing();
  wanting = want;
  if (want && !lock) {
    const wakeLock = (
      navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }
    ).wakeLock;
    if (!wakeLock) return;
    try {
      const got = await wakeLock.request('screen');
      if (wanting && !lock) lock = got;
      else got.release().catch(() => {});
    } catch {
      // Low battery, or not allowed: the session still works, the screen may dim.
    }
  } else if (!want && lock) {
    const old = lock;
    lock = null;
    old.release().catch(() => {});
  }
}

// --- wiring ----------------------------------------------------------------

let started = false;

/** Starts listening for the page being hidden. Call once, on the client. */
export function startAwayWatch() {
  if (started) return;
  started = true;
  if (web) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && !otherTabsAllowed()) hidden();
      // The browser drops the screen lock whenever the page is hidden.
      lock = null;
      holdScreen();
    });
    // Closing the tab (or going to another site) is leaving, on a computer too.
    window.addEventListener('pagehide', hidden);
  } else {
    AppState.addEventListener('change', (state) => {
      if (state === 'background') hidden();
    });
  }
}

/** Tells this module about your running session (from get_me), if any. */
export function watchSession(session: Me['active_session']) {
  watching =
    session && session.device === pageId
      ? { session: session.id, endsAt: Date.parse(session.ends_at) }
      : null;
  holdScreen();
}
