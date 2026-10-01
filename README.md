# Focus

A calm, sound-first study game for friends. Park up, study at your desk in a
shared office, earn poker chips for every minute, and spend your earned breaks
in the allotment garden. Expo (web now; iOS / Android later) + Supabase.

The design, rules and roadmap are in **[docs/PLAN.md](docs/PLAN.md)**.

## The places
- **Car park**: where the app opens. Friends who are in show as their car or bike.
- **Office**: set a timer and study. Friends sit at their desks while they study.
  While a session runs, nothing else is reachable.
- **Payout**: chips (1 per minute) and an earned break (1 minute per 5 studied).
- **Garden**: chat in speech bubbles, tend your allotment, eat, trade, smoke.
- **Kiosk**: vehicles, desk things, seeds and cigarettes.
- **Noticeboard**: add friends.

## One-time Supabase setup
1. **SQL Editor → New query**: paste and run `supabase/migrations/0001_init.sql`,
   then `supabase/migrations/0002_game.sql`. (Already ran 0001? Just run 0002:
   it migrates in place, and points become chips.)
2. **Authentication → Users → Add user → Create new user** (tick *Auto Confirm User*):
   `alice@focus.test` and `bob@focus.test`.
3. **SQL Editor**: run `supabase/seed.sql`. It creates their profiles, makes them
   friends, and lists `alice` and `bob`.

Sign in with the username (`alice` / `bob`) and the password you set.

## Run locally
```bash
npm install
npx expo start --web    # or `npx expo start` and scan the QR code with Expo Go
```
`.env` needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(see `.env.example`).

Sound starts after your first tap or click; browsers don't allow it sooner.
To preview other weather or another time of day, add
`?weather=clear|cloudy|windy|rain|storm|mist` and/or `?hour=0-23` to the URL. This
only changes what you see and hear.

## Deploy the web app
The web build is a static export (`web.output: "static"`), hosted on
[EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/).

**First deploy, from your machine** (this is where you choose the subdomain):
```bash
npx expo export --platform web
npx eas-cli@latest deploy --prod
```

**Then let GitHub Actions do it.** In the repo, go to *Settings → Secrets and
variables → Actions* and add:
- Secret `EXPO_TOKEN`: create one at expo.dev under *Account settings → Access tokens*.
- Variables `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  These are public by design: they end up in the JavaScript bundle, and RLS
  protects the data.

Pushes to `main` then deploy to production, and every pull request gets its own
preview URL (`.github/workflows/deploy-web.yml`). Until those settings exist,
the workflow skips with a notice instead of failing.

Database changes are not deployed automatically: run new files from
`supabase/migrations/` in the SQL Editor, in order.

## Checks
```bash
npm run lint
npm run typecheck
npm run test:db   # the migrations' game rules, on a throwaway Postgres
```
`test:db` needs a Postgres it can create a scratch database in, given by
`DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`).
For example: `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`.
CI (`.github/workflows/ci.yml`) runs all three on every push and pull request.

## How it fits together
- All game rules live in Postgres functions (`supabase/migrations`). The app only
  calls `supabase.rpc(...)`, and RLS allows reads only.
- Garden chat uses Supabase Realtime Broadcast on private channels; nothing is stored.
- The weather is a deterministic function of the clock (`src/weather`), so every
  player sees and hears the same sky with no server involved.
- Sound is synthesised live with the Web Audio API (`src/audio`); there are no
  audio files yet.
- Scenes are placeholder art built from shapes (`src/art`), seen from above and
  in front.
