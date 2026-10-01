import { syncClock } from './clock';
import { supabase } from './supabase';

/** See private.presence in supabase/migrations/0002_game.sql. */
export type Status = 'focused' | 'on_break' | 'idle' | 'absent';
export type Activity = 'smoking' | 'eating' | null;
export type ItemKind = 'vehicle' | 'desk' | 'seed' | 'produce' | 'cigarette';
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
  vehicle: string | null;
  activity: Activity;
  activity_until: string | null;
  active_session: { started_at: string; duration_min: number; ends_at: string } | null;
  last_completed: { id: number; ended_at: string; duration_min: number; break_min: number } | null;
  inventory: Inventory;
  server_now: string;
};

export type Friend = {
  username: string;
  display_name: string;
  status: Status;
  /** When their running session ends. */
  ends_at: string | null;
  break_ends_at: string | null;
  vehicle: string | null;
  /** Desk item slugs, in display order. */
  desk: string[];
  activity: Activity;
};

export type ShopItem = {
  slug: string;
  kind: ItemKind;
  name: string;
  price: number;
  pack_size: number;
  /** How many you already have. */
  owned: number;
  /** Seeds only: study minutes to ripen, and the harvest. */
  grow_min: number | null;
  yield: number | null;
};

export type Shop = { chips: number; items: ShopItem[] };

export type Plot = {
  bed: number;
  crop: string;
  growth_min: number;
  grow_min: number;
  ripe: boolean;
  watered: boolean;
  planted_at: string;
};

export type Gardener = {
  username: string;
  display_name: string;
  status: Status;
  break_ends_at: string | null;
  activity: Activity;
  activity_until: string | null;
  plots: Plot[];
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
  me: Gardener & { inventory: Inventory };
  neighbours: Gardener[];
  trades: Trade[];
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
  addFriend: (username: string) =>
    rpc<{ username: string }>('add_friend', { p_username: username }),

  startSession: (minutes: number) => rpc<Me>('start_session', { p_minutes: minutes }),
  cancelSession: () => rpc<Me>('cancel_session'),
  goHome: () => rpc<Me>('go_home'),

  getShop: () => rpc<Shop>('get_shop'),
  buy: (item: string) => rpc<Shop>('buy', { p_item: item }),

  getGarden: () => rpc<Garden>('get_garden'),
  plant: (bed: number, seed: string) => rpc<Garden>('plant', { p_bed: bed, p_seed: seed }),
  water: () => rpc<Garden>('water'),
  harvest: (bed: number) => rpc<Garden>('harvest', { p_bed: bed }),
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
};

export const MAX_SESSION_MIN = 120;
/** Mirrors private.break_minutes: 1 minute of break per 5 studied, at least 1. */
export const breakMinutes = (sessionMin: number) => Math.max(1, Math.round(sessionMin / 5));
/** Mirrors the 4 beds per plot in public.plots. */
export const BEDS = 4;
