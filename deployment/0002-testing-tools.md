# 0002 · Testing mode

Hacks for testing the game on your own machine without studying for real:
finish a session at once, skip ahead in time (so crops grow and wither), and
give yourself chips, items and ripe crops.

Two switches keep this away from real players:

- the **Test** button only exists in a build made with
  `EXPO_PUBLIC_TESTING=true`, which you set in your local `.env` and nowhere
  else (not in GitHub, so the deployed site never has it), and
- the server only lets accounts you've marked as testers use the tools, so
  nobody can cheat with a modified app either.

## 1. Run migrations 0005 to 0007

Supabase dashboard → **SQL Editor** → **New query** → paste the whole of
`supabase/migrations/0005_testing.sql` → **Run**. Then do the same with
`0006_growing_and_desks.sql` and `0007_post_and_first_day.sql`. (Each runs
once, in order, after 0004.)

## 2. Turn testing mode on locally

Add this line to `.env` on your machine:

```
EXPO_PUBLIC_TESTING=true
```

Then restart the dev server with its cache cleared, or the old setting sticks:

```bash
npx expo start --web --clear
```

## 3. Mark your account as a tester

```sql
update public.profiles set tester = true where username = 'your-username';
```

A small **Test** button appears under the place name on every screen,
including the office during a session. (If you press it before running the
SQL, it shows you this line with your username filled in.)

## 4. What the Test button does

| Button | What happens |
|---|---|
| **Finish my session** | Shown while you're studying: skips to the end of the session, so it pays out and the payout screen opens. |
| **5 min … 3 days** | Skips you ahead. Sessions that would have ended do, breaks run out (you're idle, then away), and crops grow, ripen and wither as if that time had passed. |
| **+100 / +1000 / −100** chips | Changes your chip balance (never below 0). |
| **Ripen my crops** | Everything growing in your beds is ripe now. Skip 2 days afterwards to see them wither. |
| **3 of each seed / 3 of each crop / 5 cigarettes** | Puts them in your basket. |

Skipping only moves **your own** clock: your sessions, arrival, going home,
smoking, and your beds. Friends' clocks don't move, and the weather and time of
day follow the real clock (preview other weather with `?weather=rain&hour=22`
in the URL).

Crops grow by the real clock: radishes take a day, carrots a day and a half,
strawberries 2 days, tomatoes 3, sunflowers 4 and pumpkins 5, and a watered bed
grows half as fast again for a day. So **1 day** then **1 day** grows radishes;
water in between and they're ready sooner.

## Trying a first day

The tips and the first-session skip are for new players:

- **Tips:** the noticeboard's **Show the tips for new players again** brings
  them all back for your account.
- **Skipping the first session** only works on an account that has never
  finished one. To see it, join with a fresh invite as a second player (in a
  private window). Then you'll see the whole first day: the welcome, the
  office tips, the skip, the payout and the garden.

## Trying "leave the page and the session stops"

On a phone, start a short session, switch to another app or tab for a few
seconds and come back: it carries on. Stay away for more than 10 seconds and
it stops, and the office says so.

On a computer, other tabs and windows are fine: switch away for as long as
you like and the session carries on. Closing the tab stops it (open Focus
Together again after 10 seconds and the office says so), but a reload doesn't. To try
a phone's rules on a computer, use the browser's device mode (in Chrome, F12,
then the phone icon).

## The same from the SQL Editor

Handy for setting up another player, without signing in as them:

```sql
-- Chips
update public.profiles set chips = chips + 1000 where username = 'alice';

-- Items (any slug from public.items)
insert into public.inventory (user_id, item, qty)
select id, 'tomato_seeds', 6 from public.profiles where username = 'alice'
on conflict (user_id, item) do update set qty = public.inventory.qty + excluded.qty;

-- Bring back the tips for new players
update public.profiles set tips = '{}' where username = 'alice';

-- Ripen everything alice has planted
update public.plots b set grown_s = c.grow_hours * 3600.0, settled_at = now()
from public.crops c
where c.produce = b.crop
  and b.user_id = (select id from public.profiles where username = 'alice');
```

## Turning it off

Remove `EXPO_PUBLIC_TESTING=true` from `.env` (and restart with `--clear`), and:

```sql
update public.profiles set tester = false where username = 'your-username';
-- or everyone at once, before you hand the game to friends:
update public.profiles set tester = false;
```

The server checks the flag on every call, so a player without it can't use
the tools even with a modified app.
