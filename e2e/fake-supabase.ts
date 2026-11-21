import type { Page, Route, WebSocketRoute } from '@playwright/test';

import type {
  Crash,
  Friend,
  FriendOfFriend,
  FriendRequests,
  Garden,
  Invite,
  Listing,
  Me,
  Place,
  Plot,
  Post,
  Profile,
  Shop,
  ShopItem,
  SignupCheck,
  Status,
} from '@/lib/api';
import type { Looks } from '@/lib/looks';
import { isUsername, normalUsername } from '@/lib/username';

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
/** An invite to Bob's session, which is running. */
export const STUDY_INVITE = 'B0BSTUDY';
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
  'invite',
  'home_screen',
  'arrange',
  'away',
  'drive',
  'email',
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
    vehicle_health: 100,
    parked: null,
    insured_until: null,
    crashes: [],
    activity: null,
    activity_until: null,
    hard_mode: false,
    email: 'nate@studymail.co.uk',
    under_18: false,
    active_session: null,
    last_completed: null,
    left_session: null,
    sessions_done: 3,
    sessions_studied: 3,
    streak: 1,
    ripe: [],
    letters: 0,
    friend_requests: 0,
    desk_items: [],
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
      vehicle_health: 100,
      parked: null,
      desk_items: [{ item: 'mug', x: -36, y: -24 }],
      activity: null,
      activity_until: null,
    },
  ];
  /** Looks people have chosen, by username. */
  looks: Record<string, Looks> = {};
  /** Friends of your friends who are at work. */
  friendsOfFriends: FriendOfFriend[] = [];
  /** Asking to be friends: who has asked you, and whom you've asked. */
  requests: FriendRequests = { to_you: [], from_you: [] };
  /** What a friend's profile says, whoever they are. */
  profile: Omit<Profile, 'username' | 'display_name' | 'status' | 'ends_at' | 'break_ends_at'> = {
    friends_since: '2026-09-01T09:00:00Z',
    friends: 6,
    in_common: 2,
    last_active: iso(-45),
    minutes_studied: 1250,
    sessions_studied: 38,
    days_studied: 14,
    net_worth: 1420,
    server_now: iso(0),
  };
  /** Your plants, and your market stall. */
  plots: Plot[] = [];
  stall: Listing[] = [];
  /** Bob's market stall. */
  bobStall: Listing[] = [{ id: 11, item: 'strawberry', qty: 5, price: 3 }];
  /** Letters to you (waiting in the post box until `read_at`), and from you. */
  letters: Post['letters'] = [];
  sent: Post['sent'] = [];
  /** Invites you've made that the server still lists (it leaves out expired ones). */
  invites: Invite[] = [];
  /** Friends in the garden as you get there. */
  inGarden: Walker[] = [];
  /** You, already in the garden on another device: it says where you are as you get there. */
  elsewhere: Omit<Walker, 'username'> | null = null;
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
  /** What the shed says about your vehicle's insurance. */
  insurance = { price: 30, days: 7 };
  /** Invites to your session you've made: whoever opens one studies with you. */
  sessionInvites: string[] = [];
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

  /** The page's Realtime connections. */
  private sockets: WebSocketRoute[] = [];
  /** The Realtime channels the page has joined, such as "garden:bob". */
  readonly joined = new Set<string>();

  /**
   * A broadcast on `username`'s garden channel (what they say goes on their
   * chat channel): a friend's, or yours from another device.
   */
  broadcastAs(username: string, event: string, payload: object) {
    const topic = `realtime:garden${event === 'say' ? '-chat' : ''}:${username}`;
    const message = [null, null, topic, 'broadcast', { type: 'broadcast', event, payload }];
    this.sockets.forEach((ws) => ws.send(JSON.stringify(message)));
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
        hard: false,
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
    this.sockets.push(ws);
    ws.onMessage((message) => {
      // The app's own broadcasts come as binary.
      if (typeof message !== 'string') {
        this.broadcasts += 1;
        return;
      }
      const [joinRef, ref, topic, event] = JSON.parse(message) as [string, string, string, string];
      if (event === 'broadcast') this.broadcasts += 1;
      if (event !== 'phx_join' && event !== 'heartbeat') return;
      if (event === 'phx_join') this.joined.add(topic.replace(/^realtime:/, ''));
      const reply = { status: 'ok', response: { postgres_changes: [] } };
      ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', reply]));
      const you = this.elsewhere;
      if (event === 'phx_join' && you && topic === `realtime:garden:${this.me.username}`)
        setTimeout(() => this.broadcastAs(this.me.username, 'pos', you), 300);
      if (event !== 'phx_join') return;
      const broadcast = (event: string, payload: object) =>
        ws.send(
          JSON.stringify([null, null, topic, 'broadcast', { type: 'broadcast', event, payload }])
        );
      // Where they are, on their garden channel; what they say, on their chat channel.
      const walker = this.inGarden.find((f) => topic === `realtime:garden:${f.username}`);
      if (walker)
        setTimeout(
          () => broadcast('pos', { x: walker.x, y: walker.y, ...(walker.sit && { sit: 1 }) }),
          300
        );
      const talker = this.inGarden.find((f) => topic === `realtime:garden-chat:${f.username}`);
      if (talker?.say) setTimeout(() => broadcast('say', { text: talker.say }), 400);
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
      friend_requests: this.requests.to_you.length,
      server_now: iso(0),
    };
  }

  /** A crash, as the server lists it. */
  crashOf(
    driver: string,
    driverName: string,
    owner: string,
    ownerName: string,
    vehicle: string,
    damage: number
  ): Crash {
    const price = vehicle === 'bike' ? 60 : 300;
    return {
      id: 70 + this.calls.length,
      driver,
      driver_name: driverName,
      owner,
      owner_name: ownerName,
      vehicle,
      damage,
      cost: Math.ceil((price * damage) / 200),
      at: iso(0),
      status: 'open',
      paid_by: null,
      paid: null,
    };
  }

  /** Someone who's just become your friend, at home. */
  private befriend(username: string, display_name: string) {
    this.friends.push({
      username,
      display_name,
      status: 'absent',
      ends_at: null,
      break_ends_at: null,
      desk: null,
      place: null,
      arrived_at: null,
      vehicle: null,
      vehicle_health: 100,
      parked: null,
      desk_items: [],
      activity: null,
      activity_until: null,
    });
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
    const me = this.me;
    const price = this.shop.find((i) => i.slug === me.vehicle)?.price ?? 0;
    return {
      chips: me.chips,
      items: this.shop,
      vehicle: me.vehicle,
      vehicle_health: me.vehicle_health,
      repair_cost: Math.ceil((price * (100 - me.vehicle_health)) / 200),
      insured_until: me.insured_until,
      insurance_price: this.insurance.price,
      insurance_days: this.insurance.days,
    };
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
    get_invites: (): Invite[] => this.invites,
    get_friend_requests: () => this.requests,
    get_friends_of_friends: () => this.friendsOfFriends,
    get_looks: () => this.looks,
    save_push: () => null,
    drop_push: () => null,
    place_desk_item: ({ p_item, p_x, p_y }) => {
      const item = String(p_item);
      const x = Math.max(-42, Math.min(42, Number(p_x)));
      const y = Math.max(-44, Math.min(-12, Number(p_y)));
      this.me.desk_items = [...this.me.desk_items.filter((t) => t.item !== item), { item, x, y }];
      return this.now();
    },
    store_desk_item: ({ p_item }) => {
      this.me.desk_items = this.me.desk_items.filter((t) => t.item !== p_item);
      return this.now();
    },
    set_looks: ({ p_looks }) => {
      this.looks = { ...this.looks, [this.me.username]: p_looks as Looks };
      return this.looks;
    },
    switch_desk: ({ p_desk }) => {
      const desk = Number(p_desk);
      if (this.me.status === 'focused')
        throw new Error("You can't change desks while you're studying");
      if ([...this.friends, ...this.friendsOfFriends].some((f) => f.desk === desk))
        throw new Error("Someone's at that desk");
      Object.assign(this.me, { desk, place: 'office' } satisfies Partial<Me>);
      return this.now();
    },
    add_friend: ({ p_username }) => {
      const username = normalUsername(String(p_username));
      if (this.friends.some((f) => f.username === username))
        throw new Error(`You're already friends with ${username}`);
      const theirs = this.requests.to_you.find((r) => r.username === username);
      if (theirs) {
        this.requests.to_you = this.requests.to_you.filter((r) => r !== theirs);
        this.befriend(theirs.username, theirs.display_name);
        return { username, friends: true };
      }
      if (this.requests.from_you.some((r) => r.username === username))
        throw new Error(`You've already asked ${username}`);
      const display_name = username[0].toUpperCase() + username.slice(1);
      this.requests.from_you.push({ username, display_name });
      return { username, friends: false };
    },
    answer_friend_request: ({ p_username, p_accept }) => {
      const request = this.requests.to_you.find((r) => r.username === p_username);
      if (!request) throw new Error(`No request from ${String(p_username)}`);
      this.requests.to_you = this.requests.to_you.filter((r) => r !== request);
      if (p_accept) this.befriend(request.username, request.display_name);
      return this.requests;
    },
    withdraw_friend_request: ({ p_username }) => {
      const asked = this.requests.from_you.some((r) => r.username === p_username);
      if (!asked) throw new Error(`You haven't asked ${String(p_username)}`);
      this.requests.from_you = this.requests.from_you.filter((r) => r.username !== p_username);
      return this.requests;
    },
    get_profile: ({ p_username }): Profile => {
      const f = this.friends.find((f) => f.username === p_username);
      if (!f) throw new Error(`You're not friends with ${String(p_username)}`);
      const { username, display_name, status, ends_at, break_ends_at } = f;
      return { username, display_name, status, ends_at, break_ends_at, ...this.profile };
    },
    remove_friend: ({ p_username }) => {
      const friend = this.friends.find((f) => f.username === p_username);
      if (!friend) throw new Error(`You're not friends with ${String(p_username)}`);
      this.friends = this.friends.filter((f) => f !== friend);
      return { username: friend.username };
    },

    check_signup: ({ p_code, p_username, p_email }): SignupCheck => {
      const code = String(p_code)
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
      // An invite to Bob's session, which runs for another 40 minutes.
      if (code === STUDY_INVITE) return { ok: true, from: 'Bob', studying_until: iso(40) };
      if (code !== INVITE)
        return { ok: false, reason: "That invite code isn't valid, or it's been used" };
      if (p_email && !String(p_email).includes('@'))
        return { ok: false, from: 'Alice', reason: "That doesn't look like a real email address" };
      if (!isUsername(normalUsername(String(p_username))))
        return {
          ok: false,
          from: 'Alice',
          reason: 'Usernames are 3 to 20 letters, numbers or _. Accents are fine',
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
          hard: this.me.hard_mode,
        },
      } satisfies Partial<Me>);
      return this.now();
    },
    join_session: ({ p_username, p_device }) => {
      const f = this.friends.find((f) => f.username === p_username);
      if (!f) throw new Error('You can only join friends');
      if (f.status !== 'focused' || !f.ends_at) throw new Error(`${f.display_name} isn't studying`);
      const minutes = Math.ceil((Date.parse(f.ends_at) - Date.now()) / 60_000);
      Object.assign(this.me, {
        status: 'focused',
        place: 'office',
        left_session: null,
        active_session: {
          id: 500 + this.calls.length,
          started_at: iso(-minutes + (Date.parse(f.ends_at) - Date.now()) / 60_000),
          duration_min: minutes,
          ends_at: f.ends_at,
          device: String(p_device),
          hard: this.me.hard_mode,
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
      // Away for longer than the grace, in hard mode: the session stops.
      if (running?.hard && running.id === p_session && away > AWAY_GRACE_S)
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
    set_hard_mode: ({ p_on }) => {
      this.me.hard_mode = !!p_on;
      return this.now();
    },
    set_email: ({ p_email }) => {
      const email = String(p_email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email))
        throw new Error("That doesn't look like a real email address");
      this.me.email = email;
      return this.now();
    },
    invite_to_session: () => {
      const running = this.me.active_session;
      if (!running) throw new Error('Start a session first');
      const code = `STUDY${this.sessionInvites.length + 100}`;
      this.sessionInvites.push(code);
      return { code, expires_at: iso(14 * 24 * 60), ends_at: running.ends_at };
    },
    use_invite: ({ p_code, p_device }) => {
      const code = String(p_code);
      if (code !== STUDY_INVITE && code !== INVITE)
        throw new Error("That invite isn't valid, or it's been used");
      const from = code === STUDY_INVITE ? 'Bob' : 'Alice';
      if (!this.friends.some((f) => f.display_name === from))
        this.befriend(from.toLowerCase(), from);
      const host = this.friends.find((f) => f.display_name === from)!;
      if (code === STUDY_INVITE && !this.me.active_session) {
        Object.assign(host, { status: 'focused', ends_at: iso(40) } satisfies Partial<Friend>);
        this.rpc.join_session({ p_username: host.username, p_device });
        return {
          from,
          username: host.username,
          session: true,
          joined: true,
          note: null,
          me: this.now(),
        };
      }
      return {
        from,
        username: host.username,
        session: code === STUDY_INVITE,
        joined: false,
        note: null,
        me: this.now(),
      };
    },
    park: ({ p_x, p_y, p_a }) => {
      if (!this.me.vehicle) throw new Error('You came on foot');
      if (this.me.status === 'absent')
        Object.assign(this.me, { status: 'idle', desk: 7 } satisfies Partial<Me>);
      this.me.place = 'outside';
      this.me.parked = { x: Number(p_x), y: Number(p_y), a: Number(p_a) };
      return this.now();
    },
    crash: ({ p_username, p_speed }) => {
      const f = this.friends.find((f) => f.username === p_username);
      if (!f?.vehicle) throw new Error("You can only bump into friends' vehicles");
      const damage = Math.min(30, Math.floor(Number(p_speed) / 6));
      if (damage < 3) return this.now();
      this.me.vehicle_health = Math.max(0, this.me.vehicle_health - damage);
      f.vehicle_health = Math.max(0, f.vehicle_health - damage);
      this.me.crashes = [
        this.crashOf('nate', 'Nate', f.username, f.display_name, f.vehicle, damage),
        ...this.me.crashes,
      ];
      return this.now();
    },
    bump: ({ p_speed }) => {
      if (!this.me.vehicle) throw new Error("You're not driving anything");
      const damage = Math.min(30, Math.floor(Number(p_speed) / 6));
      if (damage >= 3) this.me.vehicle_health = Math.max(0, this.me.vehicle_health - damage);
      return this.now();
    },
    claim_crash: ({ p_id, p_claim }) => {
      const crash = this.me.crashes.find((c) => c.id === p_id && c.status === 'open');
      if (!crash) throw new Error("That's been settled");
      Object.assign(
        crash,
        p_claim ? { status: 'claimed', paid_by: 'driver', paid: crash.cost } : { status: 'waived' }
      ) satisfies Partial<Crash>;
      if (p_claim) this.me.vehicle_health = Math.min(100, this.me.vehicle_health + crash.damage);
      return this.now();
    },
    smoke: () => {
      if (this.me.status === 'absent') throw new Error('Park up or walk about first');
      this.take('cigarette', 1);
      Object.assign(this.me, { activity: 'smoking', activity_until: iso(3) } satisfies Partial<Me>);
      return this.garden();
    },
    repair_vehicle: () => {
      const shop = this.shopNow();
      if (this.me.chips < shop.repair_cost) throw new Error('Not enough chips');
      this.me.chips -= shop.repair_cost;
      this.me.vehicle_health = 100;
      return this.shopNow();
    },
    buy_insurance: () => {
      if (!this.me.vehicle) throw new Error("You've nothing to insure");
      this.me.chips -= this.insurance.price;
      this.me.insured_until = iso(this.insurance.days * 24 * 60);
      return this.shopNow();
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
      this.give(item.slug, item.pack_size);
      if (item.kind === 'vehicle')
        Object.assign(this.me, { vehicle: item.slug, vehicle_health: 100 });
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
