import type { Point } from './gardenMap';

/**
 * Where friends are standing in the garden, as last heard over the garden
 * channel, for the figures that follow them and for "who's next to me?".
 */
export class Whereabouts {
  private spots = new Map<string, Point>();
  private strides = new Map<string, number>();
  private watchers = new Map<string, Set<(at: Point) => void>>();

  get(username: string) {
    return this.spots.get(username);
  }

  /** Records where someone is; returns true when they've walked far enough for a footstep. */
  set(username: string, at: Point, stride: number) {
    const before = this.spots.get(username);
    this.spots.set(username, at);
    this.watchers.get(username)?.forEach((fn) => fn(at));
    if (!before) return false;
    const walked = (this.strides.get(username) ?? 0) + Math.hypot(at.x - before.x, at.y - before.y);
    this.strides.set(username, walked >= stride ? 0 : walked);
    return walked >= stride;
  }

  watch(username: string, fn: (at: Point) => void) {
    const set = this.watchers.get(username) ?? new Set();
    set.add(fn);
    this.watchers.set(username, set);
    return () => {
      set.delete(fn);
    };
  }
}
