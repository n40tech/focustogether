# 0002 · Testing tools

Hacks for testing the game without studying for real: give yourself chips and
items, skip ahead in time, and ripen your crops. They only work for accounts
you mark as testers, and only you can do that, from the SQL Editor.

## 1. Run migration 0005

Supabase dashboard → **SQL Editor** → **New query** → paste the whole of
`supabase/migrations/0005_testing.sql` → **Run**. (Run it once, after 0004.)

## 2. Turn the tools on for your account

```sql
update public.profiles set tester = true where username = 'your-username';
```

Within about 10 seconds (or after a refresh), a small **Test** button appears
under the place name, on every screen, including the office during a session.

## 3. What the Test button does

| Button | What happens |
|---|---|
| **+100 / +1000 / −100** chips | Changes your chip balance (never below 0). |
| **Finish my session** | Shown while you're studying: skips to the end of the session, so it pays out and the payout screen opens. |
| **5 min / 30 min / 2 hours / 1 day** | Skips you ahead. Sessions that would have ended do, breaks run out (you're idle, then away), and crops age and wither as if that time had passed. |
| **Ripen my crops** | Everything planted in your beds is ripe now. Skip 2 days afterwards to see them wither. |
| **3 of each seed / 3 of each crop / 5 cigarettes** | Puts them in your basket. |

Skipping only moves **your own** clock: your sessions, arrival, going home,
smoking, and your beds. Friends' clocks don't move, and the weather and time of
day follow the real clock (preview other weather with `?weather=rain&hour=22`
in the URL).

## The same from the SQL Editor

Handy for setting up another player, without signing in as them:

```sql
-- Chips
update public.profiles set chips = chips + 1000 where username = 'alice';

-- Items (any slug from public.items)
insert into public.inventory (user_id, item, qty)
select id, 'tomato_seeds', 6 from public.profiles where username = 'alice'
on conflict (user_id, item) do update set qty = public.inventory.qty + excluded.qty;

-- Ripen everything alice has planted
update public.plots b set growth_min = c.grow_min, ripe_at = now()
from public.crops c
where c.produce = b.crop and b.growth_min < c.grow_min
  and b.user_id = (select id from public.profiles where username = 'alice');
```

## Turning them off

```sql
update public.profiles set tester = false where username = 'your-username';
-- or everyone at once, before you hand the game to friends:
update public.profiles set tester = false;
```

The server checks the flag on every call, so a player without it can't use
the tools even with a modified app.
