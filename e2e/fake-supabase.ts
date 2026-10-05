import type { Page, Route, WebSocketRoute } from '@playwright/test';

import type {
  Friend,
  Garden,
  Invite,
  Listing,
  Me,
  Place,
  Plot,
  Post,
  Shop,
  ShopItem,
  SignupCheck,
  Status,
} from '@/lib/api';

/**
 * A pretend Supabase for the browser tests. The app's calls are answered from
 * the state below, which a test sets up first and looks at afterwards. It
 * plays the server's part only roughly, enough to click through the app: the
 * real rules are tested in supabase/tests.
 */

/** Where the test build looks for Supabase (see e2e/serve.mjs). Nothing's there. */
export const SUPABASE_URL = 'https://example.supabase.co';
/** Where supabase-js keeps your session in the browser, for that address. */
const SESSION_KEY = 'sb-example-auth-token';

/** The invite code the fake accepts. */
export const INVITE = 'K7QM4XPA';
/** Mirrors AWAY_GRACE_S in src/lib/api.ts. */
const AWAY_GRACE_S = 10;
/** Every tip in the app: tests that aren't about tips start with them all seen. */
export const ALL_TIPS = [
  'welcome',
  'study',
  'stay',
  'walk',
  'seeds',
  'plant',
  'water',
  'post',
  'friends',
];

const USER_ID = '00000000-0000-4000-8000-00000000000a';

/** A time `minutes` from now (or ago, if negative), as the server writes it. */
export const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

type Args = Record<string, unknown>;
type Call = { fn: string; args: Args; status: Status };
/** A friend walking about the garden, as they tell everyone over Realtime. */
type Walker = { username: string; x: number; y: number; sit?: boolean; say?: string };

/** A plant left too long after it ripened: it has to be cleared. */
export const withered = (bed: number, spot: number, crop = 'radish'): Plot => ({
  bed,
  spot,
  crop,
  progress: 1,
  grow_hours: 24,
  yield: 1,
  ripe: false,
  withered: true,
  ripe_at: iso(-3000),
  withers_at: iso(-120),
  watered: false,
  dry_at: null,
  planted_at: iso(-4500),
});

/** A seed just planted. */
const sprout = (bed: number, spot: number, crop: string): Plot => ({
  bed,
  spot,
  crop,
  progress: 0,
  grow_hours: 72,
  yield: 4,
  ripe: false,
  withered: false,
  ripe_at: iso(72 * 60),
  withers_at: iso(120 * 60),
  watered: false,
  dry_at: null,
  planted_at: iso(0),
});

/** A session as supabase-js keeps it. Nothing checks the token, so it isn't signed. */
function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const part = (json: object) =>
    btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const claims = { sub: USER_ID, exp: expiresAt, role: 'authenticated', aud: 'authenticated' };
  return {
    access_token: `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.unsigned`,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: USER_ID, email: 'nate@focus.test', aud: 'authenticated', role: 'authenticated' },
  };
}

export class FakeSupabase {
  /** You: Nate, at home, with a few things in your basket and every tip seen. */
  me: Me = {
    id: USER_ID,
    username: 'nate',
    display_name: 'Nate',
    chips: 120,
    status: 'absent',
    break_ends_at: null,
    desk: null,
    place: null,
    vehicle: null,
    activity: null,
    activity_until: null,
    active_session: null,
    last_completed: null,
    left_session: null,
    sessions_done: 3,
    ripe: [],
    letters: 0,
    tips: [...ALL_TIPS],
    inventory: { tomato_seeds: 2, tomato: 3, carrot: 2 },
    tester: false,
    server_now: iso(0),
  };
  /** Your friend Bob, on a break. */
  friends: Friend[] = [
    {
      username: 'bob',
      display_name: 'Bob',
      status: 'on_break',
      ends_at: null,
      break_ends_at: iso(5),
      desk: 0,
      place: 'garden',
      arrived_at: iso(-30),
      vehicle: 'bike',
      desk_items: ['mug'],
      activity: null,
    },
  ];
  /** Your plants, and your market stall. */
  plots: Plot[] = [];
  stall: Listing[] = [];
  /** Bob's market stall. */
  bobStall: Listing[] = [{ id: 11, item: 'strawberry', qty: 5, price: 3 }];
  /** Letters to you (waiting in the post box until `read_at`), and from you. */
  letters: Post['letters'] = [];
  sent: Post['sent'] = [];
  /** Friends in the garden as you get there. */
  inGarden: Walker[] = [];
  shop: ShopItem[] = [
    {
      slug: 'bike',
      kind: 'vehicle',
      name: 'Bicycle',
      price: 60,
      pack_size: 1,
      owned: 0,
      grow_hours: null,
      yield: null,
    },
  ];
  /** Start signed in, or at the sign-in page. */
  signedIn = true;
  /** The finished session whose payout you've seen already, if any. */
  payoutSeen: number | null = null;

  /** Every call the app made, in order, with your status at the time. */
  readonly calls: Call[] = [];
  /** Anything the app asked for that this fake has no answer for. */
  readonly unknown: string[] = [];
  /** Realtime broadcasts the app sent: where you are, and what you said. */
  broadcasts = 0;

  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The arguments of each call to `fn`, in order. */
  called(fn: string) {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.args);
  }

  // --- where you are ---------------------------------------------------------

  /** At your desk, not studying. */
  atDesk() {
    Object.assign(this.me, { status: 'idle', desk: 4, place: 'office' } satisfies Partial<Me>);
  }

  /** Studying at your desk. The session was started on another page, so leaving this one is fine. */
  studying(minutes = 50) {
    Object.assign(this.me, {
      status: 'focused',
      desk: 4,
      place: 'office',
      active_session: {
        id: 7,
        started_at: iso(0),
        duration_min: minutes,
        ends_at: iso(minutes),
        device: null,
      },
    } satisfies Partial<Me>);
  }

  /** On a break in the garden, after a 25-minute session whose payout you've seen. */
  onBreak() {
    Object.assign(this.me, {
      status: 'on_break',
      break_ends_at: iso(5),
      desk: 4,
      place: 'garden',
      last_completed: { id: 42, ended_at: iso(-1), duration_min: 25, chips: 27, break_min: 5 },
    } satisfies Partial<Me>);
    this.payoutSeen = 42;
  }

  // --- the page --------------------------------------------------------------

  /** Answers the page's calls to Supabase from here on. */
  async install() {
    await this.page.route(`${SUPABASE_URL}/**`, (route) => this.answer(route));
    await this.page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => this.realtime(ws));
  }

  /**
   * Opens `path` in the app, signed in or not (see `signedIn`). Always in clear
   * weather: the real weather follows the clock, and rain or a storm is so slow
   * to draw in a test browser that long walks in the garden run out of time.
   */
  async open(path: string) {
    await this.page.addInitScript(
      ({ key, session, seen }) => {
        // Only on the tab's first page, so signing out sticks across a reload.
        if (sessionStorage.getItem('e2e.ready')) return;
        sessionStorage.setItem('e2e.ready', '1');
        if (session) localStorage.setItem(key, JSON.stringify(session));
        if (seen !== null) localStorage.setItem('focus.payoutSeen', String(seen));
      },
      { key: SESSION_KEY, session: this.signedIn ? session() : null, seen: this.payoutSeen }
    );
    await this.page.goto(`${path}${path.includes('?') ? '&' : '?'}weather=clear`);
  }

  private async answer(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const fn = path.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (fn) {
      const args = (request.postDataJSON() ?? {}) as Args;
      this.calls.push({ fn, args, status: this.me.status });
      const handler = this.rpc[fn];
      if (!handler) {
        this.unknown.push(fn);
        return route.fulfill({ status: 404, json: { message: `The fake Supabase has no ${fn}` } });
      }
      try {
        return route.fulfill({ json: handler(args) ?? null });
      } catch (e) {
        // Turned down, as the database would.
        return route.fulfill({ status: 400, json: { message: (e as Error).message } });
      }
    }
    switch (path) {
      case '/auth/v1/signup':
      case '/auth/v1/token':
        this.calls.push({
          fn: path.slice('/auth/v1/'.length),
          args: request.postDataJSON() as Args,
          status: this.me.status,
        });
        return route.fulfill({ json: session() });
      case '/auth/v1/logout':
        this.calls.push({ fn: 'logout', args: {}, status: this.me.status });
        return route.fulfill({ status: 204 });
      case '/realtime/v1/api/broadcast':
        this.broadcasts += 1;
        return route.fulfill({ status: 202 });
    }
    this.unknown.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Not something the fake does' } });
  }

  /** Realtime: every channel joins, and friends already in the garden say where they are. */
  private realtime(ws: WebSocketRoute) {
    ws.onMessage((message) => {
      // The app's own broadcasts come as binary.
      if (typeof message !== 'string') {
        this.broadcasts += 1;
        return;
      }
      const [joinRef, ref, topic, event] = JSON.parse(message) as [string, string, string, string];
      if (event === 'broadcast') this.broadcasts += 1;
      if (event !== 'phx_join' && event !== 'heartbeat') return;
      const reply = { status: 'ok', response: { postgres_changes: [] } };
      ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', reply]));
      const friend = this.inGarden.find((f) => topic === `realtime:garden:${f.username}`);
      if (event !== 'phx_join' || !friend) return;
      const broadcast = (event: string, payload: object) =>
        ws.send(
          JSON.stringify([null, null, topic, 'broadcast', { type: 'broadcast', event, payload }])
        );
      setTimeout(() => {
        broadcast('pos', { x: friend.x, y: friend.y, ...(friend.sit && { sit: 1 }) });
        if (friend.say) broadcast('say', { text: friend.say });
      }, 300);
    });
  }

  // --- the server's side -----------------------------------------------------

  private now(): Me {
    return {
      ...this.me,
      ripe: this.plots
        .filter((p) => p.ripe)
        .map((p) => ({ bed: p.bed, crop: p.crop, withers_at: p.withers_at })),
      letters: this.letters.filter((l) => !l.read_at).length,
      server_now: iso(0),
    };
  }

  private garden(): Garden {
    const me = this.me;
    return {
      me: {
        username: me.username,
        display_name: me.display_name,
        chips: me.chips,
        status: me.status,
        break_ends_at: me.break_ends_at,
        activity: me.activity,
        activity_until: me.activity_until,
        inventory: me.inventory,
        plot_slot: 17,
        plots: this.plots,
        stall: this.stall,
      },
      neighbours: this.friends.map((f, i) => ({
        username: f.username,
        display_name: f.display_name,
        status: f.status,
        break_ends_at: f.break_ends_at,
        activity: f.activity,
        activity_until: null,
        plot_slot: i + 1,
        plots: [],
        stall: f.username === 'bob' ? this.bobStall : [],
      })),
      trades: [],
      server_now: iso(0),
    };
  }

  private post(serverNow = iso(0)): Post {
    return {
      letters: this.letters,
      sent: this.sent,
      waiting: this.letters.filter((l) => !l.read_at).length,
      server_now: serverNow,
    };
  }

  private shopNow(): Shop {
    return { chips: this.me.chips, items: this.shop };
  }

  private take(item: string, qty: number) {
    const have = this.me.inventory[item] ?? 0;
    if (have < qty) throw new Error(`You haven't got ${qty} of those`);
    const inventory = { ...this.me.inventory, [item]: have - qty };
    if (inventory[item] === 0) delete inventory[item];
    this.me.inventory = inventory;
  }

  private give(item: string, qty: number) {
    this.me.inventory = { ...this.me.inventory, [item]: (this.me.inventory[item] ?? 0) + qty };
  }

  /** The RPCs, by name. Each takes the call's arguments and returns what the app expects. */
  private readonly rpc: Record<string, (args: Args) => unknown> = {
    get_me: () => this.now(),
    get_friends_board: () => this.friends,
    get_invites: (): Invite[] => [],

    check_signup: ({ p_code, p_username }): SignupCheck => {
      const code = String(p_code)
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
      if (code !== INVITE)
        return { ok: false, reason: "That invite code isn't valid, or it's been used" };
      if (!/^[a-z0-9_]{3,20}$/.test(String(p_username)))
        return {
          ok: false,
          from: 'Alice',
          reason: 'Usernames are 3 to 20 lowercase letters, numbers or _',
        };
      return { ok: true, from: 'Alice' };
    },

    set_place: ({ p_place }) => {
      // Coming into the office hands you a desk.
      if (p_place === 'office' && this.me.desk === null)
        Object.assign(this.me, { desk: 7, status: 'idle' } satisfies Partial<Me>);
      this.me.place =
        this.me.status === 'focused'
          ? 'office'
          : this.me.status === 'absent'
            ? null
            : (p_place as Place);
      return this.now();
    },
    go_home: () => {
      Object.assign(this.me, {
        status: 'absent',
        break_ends_at: null,
        desk: null,
        place: null,
      } satisfies Partial<Me>);
      return this.now();
    },

    start_session: ({ p_minutes, p_device }) => {
      const minutes = Number(p_minutes);
      Object.assign(this.me, {
        status: 'focused',
        place: 'office',
        left_session: null,
        active_session: {
          id: 500 + this.calls.length,
          started_at: iso(0),
          duration_min: minutes,
          ends_at: iso(minutes),
          device: String(p_device),
        },
      } satisfies Partial<Me>);
      return this.now();
    },
    cancel_session: () => {
      Object.assign(this.me, { status: 'idle', active_session: null } satisfies Partial<Me>);
      return this.now();
    },
    skip_first_session: () => {
      const running = this.me.active_session;
      if (!running) throw new Error('No session is running');
      if (this.me.sessions_done > 0) throw new Error('Only your first session can be skipped');
      const minutes = Math.min(25, running.duration_min);
      Object.assign(this.me, {
        status: 'on_break',
        active_session: null,
        chips: this.me.chips + minutes + 1,
        sessions_done: 1,
        break_ends_at: iso(5),
        last_completed: {
          id: 60,
          ended_at: iso(0),
          duration_min: minutes,
          chips: minutes + 1,
          break_min: 5,
        },
      } satisfies Partial<Me>);
      return this.now();
    },
    leave_page: () => null,
    back_to_page: ({ p_session, p_away_s }) => {
      const running = this.me.active_session;
      const away = Number(p_away_s);
      // Away for longer than the grace: the session stops.
      if (running && running.id === p_session && away > AWAY_GRACE_S)
        Object.assign(this.me, {
          status: 'idle',
          active_session: null,
          left_session: {
            id: running.id,
            started_at: running.started_at,
            left_at: iso(-away / 60),
            duration_min: running.duration_min,
          },
        } satisfies Partial<Me>);
      return this.now();
    },
    done_tip: ({ p_tip }) => {
      const tip = String(p_tip);
      if (!this.me.tips.includes(tip)) this.me.tips = [...this.me.tips, tip];
      return this.now();
    },

    get_garden: () => this.garden(),
    plant: ({ p_bed, p_seed }) => {
      const bed = Number(p_bed);
      const spot = [0, 1, 2, 3].find((n) => !this.plots.some((p) => p.bed === bed && p.spot === n));
      if (spot === undefined) throw new Error("That bed's full: it holds four plants");
      this.take(String(p_seed), 1);
      this.plots.push(sprout(bed, spot, String(p_seed).replace(/_seeds$/, '')));
      return this.garden();
    },
    water: () => this.garden(),
    clear_bed: ({ p_bed }) => {
      this.plots = this.plots.filter((p) => p.bed !== Number(p_bed) || !p.withered);
      return this.garden();
    },
    eat: ({ p_item }) => {
      this.take(String(p_item), 1);
      return this.garden();
    },
    bin_item: ({ p_item, p_qty }) => {
      this.take(String(p_item), Number(p_qty));
      return this.garden();
    },
    list_item: ({ p_item, p_qty, p_price }) => {
      const qty = Number(p_qty);
      this.take(String(p_item), qty);
      this.stall.push({
        id: 31 + this.stall.length,
        item: String(p_item),
        qty,
        price: Number(p_price),
      });
      return this.garden();
    },
    buy_listing: ({ p_id, p_qty }) => {
      const listing = this.bobStall.find((l) => l.id === p_id);
      if (!listing) throw new Error("That's been sold");
      const qty = Number(p_qty);
      this.me.chips -= listing.price * qty;
      listing.qty -= qty;
      this.bobStall = this.bobStall.filter((l) => l.qty > 0);
      this.give(listing.item, qty);
      return this.garden();
    },

    get_shop: () => this.shopNow(),
    buy: ({ p_item }) => {
      const item = this.shop.find((i) => i.slug === p_item);
      if (!item) throw new Error("The shed doesn't sell that");
      this.me.chips -= item.price;
      item.owned += item.pack_size;
      if (item.kind === 'vehicle') this.me.vehicle = item.slug;
      return this.shopNow();
    },

    get_post: () => this.post(),
    pick_up_post: () => {
      // The app marks letters picked up just now as new.
      const now = iso(0);
      for (const letter of this.letters) letter.read_at ??= now;
      return this.post(now);
    },
    send_letter: ({ p_to, p_body }) => {
      const friend = this.friends.find((f) => f.username === p_to);
      if (!friend) throw new Error('You can only write to friends');
      this.sent.unshift({
        id: 90 + this.sent.length,
        to: friend.username,
        to_name: friend.display_name,
        body: String(p_body),
        sent_at: iso(0),
        read_at: null,
      });
      return this.post();
    },
  };
}
