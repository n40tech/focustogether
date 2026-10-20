import { DESKS, type Friend, type FriendOfFriend, type Me } from '@/lib/api';
import { deskItemsOf } from '@/lib/catalog';

/** Someone at work, and so at a desk (and, if they have one, a bay or rack slot). */
export type Seat = {
  username: string;
  display_name: string;
  isMe: boolean;
  studying: boolean;
  /** Sitting at their desk: studying, or still there after a session until they get up. */
  atDesk: boolean;
  vehicle: string | null;
  deskItems: string[];
  /** A friend of a friend (not yours yet): which of your friends they know. */
  via?: string[];
};

/**
 * Who sits where right now, as you see it: index = desk = parking bay = rack
 * slot. The server hands out desks so nobody shares one with a friend or a
 * friend of a friend, but people further apart can hold the same number; then
 * whoever arrived later moves along to the next free desk. Friends of friends
 * come after your friends.
 */
export function seatsOf(
  me: Me,
  friends: Friend[],
  friendsOfFriends: FriendOfFriend[] = []
): (Seat | null)[] {
  const seats: (Seat | null)[] = Array(DESKS).fill(null);
  const take = (desk: number, seat: Seat) => {
    for (let i = 0; i < DESKS; i++) {
      const d = (desk + i) % DESKS;
      if (!seats[d]) {
        seats[d] = seat;
        return;
      }
    }
  };

  if (me.desk !== null) {
    take(me.desk, {
      username: me.username,
      display_name: me.display_name,
      isMe: true,
      studying: me.status === 'focused',
      atDesk: me.status === 'focused' || me.place === 'office',
      vehicle: me.vehicle,
      deskItems: deskItemsOf(me.inventory),
    });
  }
  const byArrival = (a: { arrived_at: string | null }, b: { arrived_at: string | null }) =>
    (a.arrived_at ?? '').localeCompare(b.arrived_at ?? '');
  const seatOf = (f: Friend | FriendOfFriend): Seat => ({
    username: f.username,
    display_name: f.display_name,
    isMe: false,
    studying: f.status === 'focused',
    atDesk: f.status === 'focused' || f.place === 'office',
    vehicle: f.vehicle,
    deskItems: f.desk_items,
  });
  [...friends]
    .filter((f) => f.desk !== null)
    .sort(byArrival)
    .forEach((f) => take(f.desk!, seatOf(f)));
  [...friendsOfFriends].sort(byArrival).forEach((f) => take(f.desk, { ...seatOf(f), via: f.via }));
  return seats;
}
