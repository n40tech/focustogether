import { syncClock } from './clock';
import { supabase } from './supabase';

/** See private.presence in supabase/migrations/0003_community.sql. */
export type Status = 'focused' | 'on_break' | 'idle' | 'absent';
export type Activity = 'smoking' | null;
export type ItemKind = 'vehicle' | 'desk' | 'seed' | 'produce' | 'cigarette';
/** Where someone is at work: at their desk, in the garden, or out in the car park. */
export type Place = 'office' | 'garden' | 'outside';
/** Item slug -> how many you have. */
export type Inventory = Record<string, number>;

export type Me = {
  id: string;
  username: string;
  display_name: string;
  chips: number;
  status: Status;
  /** When the break earned by your last completed session ends. */
  break_ends_at: string | null;
  /** Your desk (0 to DESKS - 1) while you're at work. */
  desk: number | null;
  /** Where you are while you're at work ('office' = at your desk). */
  place: Place | null;
  vehicle: string | null;
  activity: Activity;
  activity_until: string | null;
  active_session: {
    id: number;
    started_at: string;
    duration_min: number;
    ends_at: string;
    /** The page (browser tab) it was started on: leaving that page stops it. */
    device: string | null;
  } | null;
  last_completed: {
    id: number;
    ended_at: string;
    duration_min: number;
    /** What it paid: about a chip a minute, give or take a little luck. */
    chips: number;
    break_min: number;
  } | null;
  /** Your last session, if it stopped because you left the page. */
  left_session: { id: number; started_at: string; left_at: string; duration_min: number } | null;
  /** Sessions you've finished, ever. */
  sessions_done: number;
  /** Of those, the ones you studied: all but your first, if you skipped it. */
  sessions_studied: number;
  /** Your crops that are ready to pick, soonest to wither first. */
  ripe: { bed: number; crop: string; withers_at: string | null }[];
  /** Letters waiting for you in the garden's post box. */
  letters: number;
  /** Players waiting for you to say whether you'll be friends. */
  friend_requests: number;
  /** Tips you've seen through or put away (see src/components/Tip). */
  tips: string[];
  inventory: Inventory;
  /** Testing tools on (profiles.tester, set in the SQL editor). */
  tester: boolean;
  server_now: string;
};

export type Friend = {
  username: string;
  display_name: string;
  status: Status;
  /** When their running session ends. */
  ends_at: string | null;
  break_ends_at: string | null;
  /** Their desk while they're at work, else null. */
  desk: number | null;
  /** Where they are while they're at work: 'office' means sitting at their desk. */
  place: Place | null;
  arrived_at: string | null;
  vehicle: string | null;
  /** Desk item slugs, in display order. */
  desk_items: string[];
  activity: Activity;
};

/** Asking to be friends: the requests to you, and the ones you've made. */
export type FriendRequests = {
  /** Oldest first. `via`: your friends who are friends with them too. */
  to_you: { username: string; display_name: string; via: string[] }[];
  from_you: { username: string; display_name: string }[];
};

/** A friend's profile (see public.get_profile). */
export type Profile = {
  username: string;
  display_name: string;
  status: Status;
  ends_at: string | null;
  break_ends_at: string | null;
  friends_since: string;
  /** Completed sessions they studied (a skipped first one doesn't count). */
  minutes_studied: number;
  sessions_studied: number;
  /** Days they've studied on, by UK date. */
  days_studied: number;
  /** Their chips plus the shed's price of what they own. */
  net_worth: number;
  server_now: string;
};

export type ShopItem = {
  slug: string;
  kind: ItemKind;
  name: string;
  price: number;
  pack_size: number;
  /** How many you already have. */
  owned: number;
  /** Seeds only: hours to ripen in a bed nobody waters, and the harvest. */
  grow_hours: number | null;
  yield: number | null;
};

export type Shop = { chips: number; items: ShopItem[] };

/** One plant: a bed holds up to PLANTS_PER_BED, one seed each. */
export type Plot = {
  bed: number;
  /** Where in its bed (0 to PLANTS_PER_BED - 1). */
  spot: number;
  crop: string;
  /** 0 to 1: how far it has grown. Crops grow in real time, faster while watered. */
  progress: number;
  /** Hours to ripen if nobody waters it. */
  grow_hours: number;
  /** What it gives when it's picked. */
  yield: number;
  /** Ready to pick (and not yet withered). */
  ripe: boolean;
  /** Left too long after ripening: gives nothing, and has to be cleared. */
  withered: boolean;
  /** When it ripens (or ripened), if it isn't watered again. */
  ripe_at: string;
  /** When a ripe crop withers if it isn't picked (KEEPS_FOR_DAYS after ripening). */
  withers_at: string;
  /** Watered recently enough to be growing faster. */
  watered: boolean;
  /** When the last watering wears off (null if it was never watered). */
  dry_at: string | null;
  planted_at: string;
};

/** Something set out on a market stall, at a price per item. */
export type Listing = { id: number; item: string; qty: number; price: number };

export type Gardener = {
  username: string;
  display_name: string;
  status: Status;
  break_ends_at: string | null;
  activity: Activity;
  activity_until: string | null;
  /** Where their allotment sits in the shared garden grid. */
  plot_slot: number;
  plots: Plot[];
  stall: Listing[];
};

export type Trade = {
  id: number;
  from: string;
  to: string;
  /** True when it's an offer to you. */
  incoming: boolean;
  give_item: string;
  give_qty: number;
  want_item: string | null;
  want_qty: number | null;
  created_at: string;
};

export type Garden = {
  me: Gardener & { chips: number; inventory: Inventory };
  neighbours: Gardener[];
  trades: Trade[];
  server_now: string;
};

export type Invite = {
  code: string;
  expires_at: string;
  /** Who joined with it, once used. */
  used_by: string | null;
  used_at: string | null;
};

export type SignupCheck = { ok: boolean; reason?: string; from?: string };

export type Letter = {
  id: number;
  body: string;
  sent_at: string;
  /** When it was picked up from the post box (null while it waits there). */
  read_at: string | null;
};

export type Post = {
  /** Letters to you, newest first. */
  letters: (Letter & { from: string; from_name: string })[];
  /** Letters you've sent, newest first. */
  sent: (Letter & { to: string; to_name: string })[];
  /** How many are waiting for you in the post box. */
  waiting: number;
  server_now: string;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  if (data && typeof data === 'object' && 'server_now' in data)
    syncClock(data.server_now as string);
  return data as T;
}

export const api = {
  getMe: () => rpc<Me>('get_me'),
  getFriendsBoard: () => rpc<Friend[]>('get_friends_board'),
  /** Asks them; if they'd already asked you, you're friends now (`friends`). */
  addFriend: (username: string) =>
    rpc<{ username: string; friends: boolean }>('add_friend', { p_username: username }),
  getFriendRequests: () => rpc<FriendRequests>('get_friend_requests'),
  answerFriendRequest: (username: string, accept: boolean) =>
    rpc<FriendRequests>('answer_friend_request', { p_username: username, p_accept: accept }),
  withdrawFriendRequest: (username: string) =>
    rpc<FriendRequests>('withdraw_friend_request', { p_username: username }),
  getProfile: (username: string) => rpc<Profile>('get_profile', { p_username: username }),
  /** Both ways; offers between you are called off. */
  removeFriend: (username: string) =>
    rpc<{ username: string }>('remove_friend', { p_username: username }),

  /** Moves you (going to the office hands you a desk if you've just arrived). */
  setPlace: (place: Place) => rpc<Me>('set_place', { p_place: place }),
  /** `device` is this page's id: leaving this page stops the session. */
  startSession: (minutes: number, device: string) =>
    rpc<Me>('start_session', { p_minutes: minutes, p_device: device }),
  /** Starts a session that ends when a friend's does. */
  joinSession: (username: string, device: string) =>
    rpc<Me>('join_session', { p_username: username, p_device: device }),
  cancelSession: () => rpc<Me>('cancel_session'),
  /** Your first session only: ends it now, as if you'd studied it. */
  skipFirstSession: () => rpc<Me>('skip_first_session'),
  /**
   * You're back on the page a session was started on. `awaySeconds` is how
   * long it was hidden, as far as this page knows.
   */
  /** The page `device` started `session` on has been hidden (see src/lib/away). */
  leavePage: (session: number, device: string) =>
    rpc<void>('leave_page', { p_session: session, p_device: device }),
  backToPage: (session: number, device: string, awaySeconds: number | null) =>
    rpc<Me>('back_to_page', { p_session: session, p_device: device, p_away_s: awaySeconds }),
  goHome: () => rpc<Me>('go_home'),
  /** A tip seen through or put away; and all of them back again. */
  doneTip: (tip: string) => rpc<Me>('done_tip', { p_tip: tip }),
  resetTips: () => rpc<Me>('reset_tips'),

  getShop: () => rpc<Shop>('get_shop'),
  buy: (item: string) => rpc<Shop>('buy', { p_item: item }),

  getGarden: () => rpc<Garden>('get_garden'),
  plant: (bed: number, seed: string) => rpc<Garden>('plant', { p_bed: bed, p_seed: seed }),
  water: () => rpc<Garden>('water'),
  waterFriend: (username: string) => rpc<Garden>('water_friend', { p_username: username }),
  harvest: (bed: number) => rpc<Garden>('harvest', { p_bed: bed }),
  /** Pulls up whatever has withered in a bed. */
  clearBed: (bed: number) => rpc<Garden>('clear_bed', { p_bed: bed }),
  binItem: (item: string, qty: number) => rpc<Garden>('bin_item', { p_item: item, p_qty: qty }),
  eat: (item: string) => rpc<Garden>('eat', { p_item: item }),
  saveSeeds: (item: string) => rpc<Garden>('save_seeds', { p_item: item }),
  smoke: () => rpc<Garden>('smoke'),
  offerTrade: (
    to: string,
    give: string,
    giveQty: number,
    want: string | null,
    wantQty: number | null
  ) =>
    rpc<Garden>('offer_trade', {
      p_to: to,
      p_give: give,
      p_give_qty: giveQty,
      p_want: want,
      p_want_qty: wantQty,
    }),
  respondTrade: (id: number, accept: boolean) =>
    rpc<Garden>('respond_trade', { p_id: id, p_accept: accept }),
  cancelTrade: (id: number) => rpc<Garden>('cancel_trade', { p_id: id }),

  listItem: (item: string, qty: number, price: number) =>
    rpc<Garden>('list_item', { p_item: item, p_qty: qty, p_price: price }),
  unlist: (id: number) => rpc<Garden>('unlist', { p_id: id }),
  buyListing: (id: number, qty: number) => rpc<Garden>('buy_listing', { p_id: id, p_qty: qty }),

  getPost: () => rpc<Post>('get_post'),
  sendLetter: (to: string, body: string) => rpc<Post>('send_letter', { p_to: to, p_body: body }),
  pickUpPost: () => rpc<Post>('pick_up_post'),

  createInvite: () => rpc<{ code: string; expires_at: string }>('create_invite'),
  getInvites: () => rpc<Invite[]>('get_invites'),
  /** Testing tools (testers only, see 0005_testing.sql). */
  dev: {
    chips: (amount: number) => rpc<Me>('dev_chips', { p_amount: amount }),
    /** Moves your own timestamps back, which is the same as time passing for you. */
    skip: (minutes: number) => rpc<Me>('dev_skip', { p_minutes: minutes }),
    item: (item: string, qty: number) => rpc<Me>('dev_item', { p_item: item, p_qty: qty }),
    ripen: () => rpc<Me>('dev_ripen'),
  },

  /** Works signed out: checks an invite code and a username before sign-up. */
  checkSignup: (code: string, username: string) =>
    rpc<SignupCheck>('check_signup', { p_code: code, p_username: username }),
};

export const MAX_SESSION_MIN = 120;
/** Mirrors private.break_minutes: 1 minute of break per 5 studied, at least 1. */
export const breakMinutes = (sessionMin: number) => Math.max(1, Math.round(sessionMin / 5));
/** Mirrors the 4 beds per plot, and up to 4 plants per bed, in public.plots. */
export const BEDS = 4;
export const PLANTS_PER_BED = 4;
/** Mirrors private.away_grace: a page left this long during a session stops it (see src/lib/away). */
export const AWAY_GRACE_S = 10;
/** Mirrors 1000 characters in public.letters. */
export const LETTER_MAX = 1000;
/** Mirrors private.smoke_for: a cigarette burns this long. */
export const SMOKE_MINUTES = 3;
/** Mirrors private.keeps_for: a ripe crop withers this many days after it ripens. */
export const KEEPS_FOR_DAYS = 2;
/** Mirrors private.moist_for and private.watered_speed: a watering lasts a day, and
 *  meanwhile the bed grows half as fast again. */
export const WATERING_LASTS_HOURS = 24;
export const WATERED_SPEED = 1.5;
/** Mirrors profiles.desk (0-11): the office has twelve desks. */
export const DESKS = 12;
