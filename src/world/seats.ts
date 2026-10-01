import { DESKS, type Friend, type Me } from '@/lib/api';
import { deskItemsOf } from '@/lib/catalog';

/** Someone at work, and so at a desk (and, if they have one, a bay or rack slot). */
export type Seat = {
  username: string;
  display_name: string;
  isMe: boolean;
  studying: boolean;
  vehicle: string | null;
  deskItems: string[];
};

/**
 * Who sits where right now, as you see it: index = desk = parking bay = rack
 * slot. The server hands out desks so friends at work never share one, but two
 * of your friends who aren't friends with each other can hold the same number;
 * then whoever arrived later moves along to the next free desk.
 */
export function seatsOf(me: Me, friends: Friend[]): (Seat | null)[] {
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
      vehicle: me.vehicle,
      deskItems: deskItemsOf(me.inventory),
    });
  }
  [...friends]
    .filter((f) => f.desk !== null)
    .sort((a, b) => (a.arrived_at ?? '').localeCompare(b.arrived_at ?? ''))
    .forEach((f) =>
      take(f.desk!, {
        username: f.username,
        display_name: f.display_name,
        isMe: false,
        studying: f.status === 'focused',
        vehicle: f.vehicle,
        deskItems: f.desk_items,
      })
    );
  return seats;
}
