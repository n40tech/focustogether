import { syncClock } from './clock';
import { supabase } from './supabase';

export type Status = 'focused' | 'on_break' | 'absent';

export type Me = {
  id: string;
  username: string;
  display_name: string;
  points: number;
  status: Status;
  active_session: { started_at: string; duration_min: number; ends_at: string } | null;
  last_completed: { ended_at: string; duration_min: number } | null;
  server_now: string;
};

export type Friend = {
  username: string;
  display_name: string;
  points: number;
  status: Status;
  ends_at: string | null;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  if (data && typeof data === 'object' && 'server_now' in data) syncClock(data.server_now as string);
  return data as T;
}

export const api = {
  getMe: () => rpc<Me>('get_me'),
  getFriendsBoard: () => rpc<Friend[]>('get_friends_board'),
  addFriend: (username: string) => rpc<{ username: string }>('add_friend', { p_username: username }),
  startSession: (minutes: number) => rpc<Me>('start_session', { p_minutes: minutes }),
  cancelSession: () => rpc<Me>('cancel_session'),
  leave: () => rpc<Me>('leave'),
};

export const BREAK_WINDOW_MS = 80 * 60 * 1000;
export const MAX_SESSION_MIN = 120;
