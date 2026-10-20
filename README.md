# Focus Together

A calm, sound-first study game for friends. Park up, study at your desk in a
shared office, earn poker chips for every minute, and spend your earned breaks
in the allotment garden. Expo (web now; iOS / Android later) + Supabase.

The design, rules and roadmap are in **[docs/PLAN.md](docs/PLAN.md)**. Setting
up and shipping each update is in **[deployment/](deployment/)**, starting with
**[0001: set up and launch](deployment/0001-setup-and-launch.md)**. Testing a
change before a pull request is in **[docs/TESTING.md](docs/TESTING.md)**.

## The places
- **Car park**: where the app opens. Friends who are in show as their car or bike,
  in the bay that goes with their desk.
- **Office**: twelve identical desks. You get a random one when you walk in and
  keep it until you go home. Set a timer and study; while a session runs,
  nothing else is reachable. On a phone, leaving the page (another app or
  tab, or locking it) for more than 10 seconds stops the session with no
  chips. On a computer, other tabs are fine, and only closing the page stops
  it. A new player can skip their first session.
- **Payout**: a closer look at your desk, about 1 chip per minute (give or take a
  little luck), and an earned break (1 minute per 5 studied).
- **Garden**: walk about with a thumbstick (or the arrow keys), chat in speech
  bubbles, tend your allotment (one plant per seed, four to a bed; crops grow
  in real time over a few days; pick them within 2 days of ripening or they
  wither), water friends' plots, smoke, sit on a bench, throw things in the
  bins, write letters at the post box, see friends at the Friends board, and
  buy and sell at the market with friends standing next to you. Walk out
  through the gate to go back to work.
- **Shed**: vehicles, desk things, seeds and cigarettes.
- **Friends board**: friends, their profiles, asking to be friends, and
  invites. In the office, tap a friend's desk to join their session.

## One-time Supabase setup
1. **SQL Editor → New query**: paste and run each file in
   `supabase/migrations/` that your database hasn't had yet, in order
   (`0001_init.sql`, `0002_game.sql`, `0003_community.sql`,
   `0004_withering.sql`, `0005_testing.sql`, `0006_growing_and_desks.sql`,
   `0007_post_and_first_day.sql`).
   Each file runs once, ever: re-running one fails with "already exists" and
   changes nothing.
2. **Authentication → Sign In / Providers**: turn *Allow new users to sign up*
   on and *Confirm email* off. Sign-up is invite-only; the database checks.
3. **SQL Editor**: `select private.make_invite();` returns an invite code. Open
   the app, tap *Got an invite? Join*, and use it.

For testing on your own machine, add `EXPO_PUBLIC_TESTING=true` to `.env` and
mark your account as a tester: a **Test** button then finishes sessions, skips
ahead in time (so crops grow), and hands out chips, items and ripe crops. See
[deployment/0002-testing-tools.md](deployment/0002-testing-tools.md).

The full walkthrough, with checks and troubleshooting, is
[deployment/0001-setup-and-launch.md](deployment/0001-setup-and-launch.md).
(`supabase/seed.sql` is only for the local Supabase below: it makes test players,
and refuses to run on a database that already has players.)

## Run locally
Locally, Focus Together runs against a **local Supabase** in Docker, so your
friends' real data is never touched:
```bash
npm install
npx supabase start      # applies the migrations and makes test players
npx expo start --web
```
Put the local address and publishable key that `npx supabase status` prints in
`.env` (see `.env.example`), then sign in as `alice`, `bob` or `carol` (password
`focus-dev`). The full setup, and what to test before a pull request, is in
**[docs/TESTING.md](docs/TESTING.md)**.

Sound starts after your first tap or click; browsers don't allow it sooner.
On an iPhone it plays even with the silent switch on (which, like a video,
pauses music from other apps); tap the Sound button to mute Focus Together and
give the sound back.
To preview other weather or another time of day, add
`?weather=clear|cloudy|windy|rain|storm|mist` and/or `?hour=0-23` to the URL. This
only changes what you see and hear. To try two players at once, use a normal and
a private window.

## Deploy the web app
The web build is a static export (`web.output: "static"`), hosted on
[EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/).

**First deploy, from your machine** (this is where you choose the subdomain).
`.env` must have the real project's values, and no `EXPO_PUBLIC_TESTING`:
```bash
npx expo export --platform web --clear
npx eas-cli@latest deploy --prod
```
`--clear` matters: without it, Metro can reuse code it built earlier with other
values (your local Supabase's, say).

**Then let GitHub Actions do it.** In the repo, go to *Settings → Secrets and
variables → Actions* and add:
- Secret `EXPO_TOKEN`: create one at expo.dev under *Account settings → Access tokens*.
- Variables `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  These are public by design: they end up in the JavaScript bundle, and RLS
  protects the data.

Pushes to `main` then deploy to production, and every pull request gets its own
preview URL (`.github/workflows/deploy-web.yml`). Until those settings exist,
the workflow skips with a notice instead of failing.

Database changes are not deployed automatically. Each new file in
`supabase/migrations/` goes into the real project once, in order, before the
merge that needs it: Claude runs it through the Supabase connector, or you can
paste it into the SQL Editor.

## Checks
```bash
npm run lint
npm run typecheck
npx expo export --platform web   # the web build
npm run test:db                  # the migrations' game rules, on a throwaway Postgres
npm run test:web                 # click-throughs in a browser, against a pretend Supabase
```
CI (`.github/workflows/ci.yml`) runs all five on every push to `main` and every
pull request. `test:db` uses the local Supabase's Postgres (or any other, given
as `DATABASE_URL`). `test:web` builds the app itself and needs no Supabase;
run `npx playwright install chromium` once first. What to click through before
a pull request is in **[docs/TESTING.md](docs/TESTING.md)**.

## How it fits together
- All game rules live in Postgres functions (`supabase/migrations`). The app only
  calls `supabase.rpc(...)`, and RLS allows reads only.
- Garden chat and positions use Supabase Realtime Broadcast on private channels;
  nothing is stored.
- The weather is a deterministic function of the clock (`src/weather`), so every
  player sees and hears the same sky with no server involved.
- Sound is synthesised live with the Web Audio API (`src/audio`); there are no
  audio files yet.
- Scenes are placeholder art built from shapes (`src/art`), seen from above and
  in front.
- The icon, a clock at nine on sage, is drawn by `scripts/icons.mjs`: change it
  there and run `npm run icons` to write every size. `public/manifest.json` and
  `src/app/+html.tsx` give it, and the name, to browsers and phones.
- While it's in beta, a banner across the top of every place but the office
  links testers to the WhatsApp group (`src/components/BetaBanner.tsx`).
