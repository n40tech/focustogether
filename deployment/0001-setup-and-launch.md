# 0001 · Set up the community update and launch the web app

**Where you are:** migrations `0001_init.sql` and `0002_game.sql` have been run
in Supabase. This runbook takes you from there to a live web app with
invite-only sign-up. It takes about 20 minutes.

**What this update brings:** random desks that stay yours until you go home,
even rows in the car park (no kiosk), a closer look at your own desk at payout,
a walkable garden three phones wide with everyone's allotment on one grid, a
market for buying and selling between friends standing next to each other,
watering friends' plots, crops that wither if they're left unpicked for two
days, payouts of about 1 chip a minute with a little luck, and invite-only
sign-up. Since then: sessions that stop if you leave the page, tips and a
skippable first session for new players, and a post box, bins, benches and a
noticeboard in the garden.

---

## 1. Pull the branch

```bash
git fetch origin
git checkout claude/trusting-brahmagupta-u24nw3
git pull
npm install
```

## 2. Run migrations 0003 to 0007

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/migrations/0003_community.sql` and press **Run**.
3. Do the same, one at a time and in order, with `0004_withering.sql`,
   `0005_testing.sql`, `0006_growing_and_desks.sql` and
   `0007_post_and_first_day.sql`.

Each one runs as a single transaction: if anything fails, nothing is changed,
so you can fix the problem and run it again. Once one has succeeded, don't run
it a second time. It would fail on its first line, and nothing would change.
(If you've already run some, start from the first one you haven't.)

What it does to your existing data:

- Everyone keeps their chips, items and plots.
- Each player gets a permanent place in the garden grid, in the order they
  joined (`plot_slot`).
- Desks are handed out from now on, the next time each player walks into the
  office.
- A trigger on `auth.users` makes sign-up invite-only (step 3).
- From 0004: crops that are already ripe get two days from now before they
  wither.
- From 0006: crops grow in real time. Anything already planted keeps how far
  it had got (half grown stays half grown), and ripe crops keep their time.
- From 0007: each existing crop becomes the first plant in its bed (a bed now
  holds four, one seed each), and a radish or carrot plant gives one root.
  Everyone starts with no tips seen, so existing players get the new ones
  too (*Got it* puts each away for good). A session that's running while you
  run 0007 finishes as normal.

To check it worked, run this in the SQL Editor. Every player should have a
`plot_slot`:

```sql
select username, display_name, chips, plot_slot from public.profiles order by plot_slot;
```

## 3. Make sign-up invite-only

The database now refuses any new account that doesn't come with a valid
invite code, so Supabase itself has to allow sign-ups. In the dashboard:

1. **Authentication → Sign In / Providers**:
   - Turn **Allow new users to sign up** **on**. The invite check happens in
     the database, so this is safe.
   - Under **Email**, turn **Confirm email** **off**. Accounts use made-up
     `<username>@focus.test` addresses that can't receive mail.
2. Press **Save**.

(The dashboard moves these settings around from time to time. Look for the
"allow sign-ups" and "confirm email" switches.)

From now on, **Authentication → Users → Add user** fails with "Database error
creating new user". That is the invite check working: everyone joins through
the app. (`supabase/seed.sql` is only for the local Supabase used in testing:
see `docs/TESTING.md`.)

## 4. Make the first invites

Invites are 8-character codes that last 14 days. Whoever signs up with one
starts out as friends with the person who made it. Make the first ones in the
SQL Editor:

```sql
-- An invite from nobody in particular: use this to make your own account.
select private.make_invite();

-- An invite from an existing player (here alice): whoever uses it becomes alice's friend.
select private.make_invite(id) from public.profiles where username = 'alice';
```

Each query returns a code such as `K7QM4XPA`. To use one, open the app and tap
**Got an invite? Join**, or go straight to `/login?invite=K7QM4XPA`.

After that, players make their own invites on the **noticeboard** (in the car
park), up to 5 unused at a time. On the web, **Make an invite** copies a link.

## 5. Run it locally

1. Copy `.env.example` to `.env` and fill in both values. In the Supabase
   dashboard, they're under the **Connect** button (or **Project Settings →
   API Keys**):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
2. Start it:
   ```bash
   npx expo start --web
   ```
3. Join with an invite from step 4. To try two players at once, use a normal
   window and a private window, each signed in as a different player.

## 6. Deploy the web app (EAS Hosting)

The web build is a static export, hosted on EAS Hosting at
`https://<your-subdomain>.expo.app`.

### First deploy, from your machine

This is where you choose the subdomain:

```bash
npx eas-cli@latest login
npx expo export --platform web --clear
npx eas-cli@latest deploy --prod
```

`npx expo export` builds the values in your local `.env` into the app, so check
that they point at your real Supabase project first, and that
`EXPO_PUBLIC_TESTING` isn't there. Keep the `--clear`: without it, Metro can
reuse code it built earlier with other values (your local Supabase's, say).

### After that, let GitHub deploy it

In the GitHub repo, go to **Settings → Secrets and variables → Actions**:

- **Secrets** tab → **New repository secret**: `EXPO_TOKEN`. Create the token
  at expo.dev → **Account settings → Access tokens**.
- **Variables** tab → **New repository variable**: `EXPO_PUBLIC_SUPABASE_URL`
  and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, with the same values as your
  `.env`. These are public by design: they end up in the JavaScript anyway,
  and RLS protects the data.

From then on, every push to `main` deploys to production and every pull
request gets its own preview URL (`.github/workflows/deploy-web.yml`). To ship
this update, open a pull request from `claude/trusting-brahmagupta-u24nw3` into
`main` and merge it once CI is green. Until those secrets and variables exist,
the deploy job skips with a notice rather than failing.

Database changes are never deployed automatically. Each new file in
`supabase/migrations/` is run by hand in the SQL Editor, in order, like step 2.

## 7. Check it all works

With two players (A and B) who are friends:

- [ ] B joins with A's invite and arrives in the car park, already A's friend.
- [ ] A walks into the office and gets a desk. B sees A at the same desk, and
      A's car or bike in the matching bay. A keeps that desk across breaks.
- [ ] A studies a short session. The payout zooms in on A's desk and pays
      about 1 chip a minute, with a note when luck adds or takes a few.
- [ ] Both take a break. In the garden, each sees the other walking about and
      hears their footsteps, and chat bubbles appear over their heads.
- [ ] A puts something on their stall (**Stall**). B walks up to A and buys
      it from **A's stall**.
- [ ] B waters A's beds by standing next to A's plot, but can't harvest them.
- [ ] Eating a crop (**Basket → Eat**) just makes a munching sound.
- [ ] Crops grow in real time, studying or not: radishes in a day, pumpkins
      in five, sooner while watered (the bed's sheet says when).
- [ ] When A's session ends, B still sees A sitting at their desk. A only
      leaves it by going to the garden, walking out or going home.
- [ ] A crop left ripe for two days withers. Walking up to it offers **Clear
      the withered plant**, and that spot in the bed is free again afterwards.
      (To try it without waiting, use the Test button: see
      `deployment/0002-testing-tools.md`.)
- [ ] Each seed planted shows as one plant; a bed takes four, and **Pick**
      takes whatever's ripe in it.
- [ ] A new player (join with a fresh invite) sees a welcome tip in the car
      park, then tips in the office and the garden, and can **Skip my first
      session** once it starts.
- [ ] Mid-session, switch to another app or tab for a few seconds and come
      back: the session carries on. Stay away for more than 10 seconds and it
      stops, and the office says so. No chips, no break.
- [ ] B writes A a letter at the post box (bottom right of the garden). A's
      car park says a letter's waiting, and A picks it up at the post box.
- [ ] Sitting on a bench shows you sitting to friends; walking off gets you up.
- [ ] A bin takes something from your basket.
- [ ] Walking out through the garden gate takes you back to the office.
- [ ] Logging out on a break, then back in: you've gone home, not on a break.

## Troubleshooting

- **`relation "profiles" already exists`** (or any "already exists") when
  running a migration: that file has already been run on this database, so
  nothing was changed. Skip it and run the next one. This runbook starts from
  0003: don't re-run `0001_init.sql` or `0002_game.sql`.

- **"Focus is invite-only, and that invite code isn't valid"**, or **"Couldn't
  join with that invite"**: the code was used, has expired, or was mistyped.
  Make a new one.
- **"Your account's made, but this Focus needs email confirmation turned
  off"**: step 3 was missed. Turn **Confirm email** off, then confirm the
  account that was just made in the SQL Editor:
  ```sql
  update auth.users set email_confirmed_at = now()
  where email = '<username>@focus.test' and email_confirmed_at is null;
  ```
- **"Signups not allowed for this instance"**: turn **Allow new users to sign
  up** back on (step 3).
- **Friends don't appear in the garden:** you only see friends who are on a
  break and have the garden open. Both of you need to be signed in to the same
  project, and the browser console shouldn't show websocket errors.
- **No sound:** browsers only allow sound after your first tap or click; the
  Sound button says **♪ Sound on** once it's allowed. Then check the phone's
  media volume. On an iPhone, Focus plays even with the silent switch on.
  That pauses music from other apps while Focus is open, as a video would.
  Tap **Sound on** to mute Focus and give the sound back.
- **"You left the page ... so it stopped"** when you didn't mean to: the
  session's page was hidden for more than 10 seconds (another app, another
  tab, the phone locked). Focus keeps the screen on while you study, but a
  phone in low-power mode may still lock: plug it in, or lengthen its
  auto-lock.
- **The deploy job says "Skipping deploy":** a secret or variable from step 6
  is missing or misnamed.
