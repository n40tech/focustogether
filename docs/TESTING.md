# Testing Focus before a pull request

How to check a change on your own machine before you open a pull request. It's
the same every time. Section 1 is one-off setup, and the checklist in section 6
is what to tick off before each pull request.

Everything runs against a **local Supabase**: a full copy of Supabase
(database, sign-in, the API and realtime) running in Docker on your computer,
built from `supabase/migrations/`. Your friends' real data is never involved,
and you can skip time, reset and break things freely.

Short version, once you're set up:

```bash
npx supabase start                       # the local Supabase (Docker must be running)
npm run lint
npm run typecheck
npx expo export --platform web           # the web build CI makes
npm run test:db
npm run test:web                         # the browser tests
npx prettier --check "src/**/*.{ts,tsx}" "supabase/tests/*.mjs" "e2e/*.{ts,mjs}"
npx expo start --web                     # then click through (section 5)
```

Lint, typecheck, the web build, the database tests and the browser tests are
what CI runs on every pull request, so if they pass here they'll pass there.
Formatting isn't checked by CI, but keeping to it keeps your diffs to what you
changed.

---

## 1. Setting up (once)

1. Install **Docker Desktop** (Mac or Windows; on Linux, Docker Engine) from
   [docker.com](https://www.docker.com/products/docker-desktop/), and start it.
2. In the repo: `npm install`, then `npx playwright install chromium`, which
   downloads the browser the browser tests use.
3. Start the local Supabase:
   ```bash
   npx supabase start
   ```
   The first time, this downloads Supabase's images (about 7 GB, so check you
   have the space, and give it a few minutes); after that it starts in
   seconds. It applies every migration in `supabase/migrations/`, then
   `supabase/seed.sql`, which makes three test players:

   | Username | Password | |
   |---|---|---|
   | `alice` | `focus-dev` | friends with bob and carol |
   | `bob` | `focus-dev` | friends with alice and carol |
   | `carol` | `focus-dev` | friends with alice and bob |

   All three are testers (they get the **Test** button), and there's a spare
   invite, `TESTJOIN`, for trying the Join form. It works once, like any
   invite; `npx supabase db reset` brings it back.
4. Point the app at it. `npx supabase status` prints the local addresses and
   keys. Put these in `.env` (copy `.env.example` if you haven't got one):
   ```
   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<the "Publishable" key from npx supabase status>
   EXPO_PUBLIC_TESTING=true
   ```
   `.env` is never committed (it's in `.gitignore`), and deploys get their
   values from GitHub, so none of this reaches the real site. (If you ever
   deploy by hand with `npx eas-cli@latest deploy`, switch `.env` to the real
   project's values and remove `EXPO_PUBLIC_TESTING` first, and build with
   `npx expo export --platform web --clear`. Without `--clear`, Metro reuses
   code it built with the old values, and the site would talk to your local
   Supabase.)
5. `npx expo start --web --clear`, and sign in as `alice`.

## 2. Each time you sit down to work

- Start Docker Desktop, then `npx supabase start` and `npx expo start --web`.
- **Studio**, the local dashboard, is at <http://127.0.0.1:54323>: browse the
  tables, or run SQL in its SQL Editor.
- When you're done, `npx supabase stop` frees the memory (not the disk: Docker
  keeps the images). Your local players and their plots are kept for next
  time.
- To start afresh, `npx supabase db reset` rebuilds the local database from the
  migrations and the seed: back to alice, bob and carol with nothing. A
  browser that was signed in before the reset then says "No profile for this
  account": press **Log out** and sign in again.
- Never connect the CLI to the real project (`supabase link`, or any command
  with `--linked`). New migrations reach the real database by hand, following
  the runbooks in `deployment/`.

## 3. The automated checks

| Command | Checks | In CI |
|---|---|---|
| `npm run lint` | ESLint with Expo's rules, including React's rules for hooks | yes |
| `npm run typecheck` | TypeScript | yes |
| `npx expo export --platform web` | the web build: every page builds | yes |
| `npm run test:db` | the game rules, as scenarios (`supabase/tests/game.test.mjs`) | yes |
| `npm run test:web` | the main ways through the app, clicked through in a browser (`e2e/`) | yes |
| `npx prettier --check "src/**/*.{ts,tsx}" "supabase/tests/*.mjs" "e2e/*.{ts,mjs}"` | formatting (the style is in `.prettierrc.json`) | no |

- `npm run test:db` uses the local Supabase's database server: with it
  running, it just works. It builds a separate scratch database there
  (`focus_test`) from the migrations, and never touches your local players.
  To use another Postgres, set `DATABASE_URL` (CI uses a plain Postgres 16).
- `npx expo export` writes to `dist/`, which is gitignored. Delete it when
  you're done if you like.
- `npm run test:web` builds the web app (a minute or two), then clicks
  through it in Chromium at phone size, as one player: signing in, the office,
  the payout, the garden, the shed and a first day. It doesn't need the local
  Supabase, and it ignores your `.env`: the tests stand in for Supabase
  themselves (`e2e/fake-supabase.ts`), so they're quick and always start from
  the same place. They can't check the rules (that's `test:db`) or two real
  players (that's you, in section 5).
- A failing browser test says which step failed, and leaves a screenshot and
  a trace in `test-results/`. `npx playwright show-trace <the trace.zip>`
  replays the test step by step. In CI, the report is kept with the run:
  open the failed run on GitHub and download **playwright-report** at the
  bottom of its Summary.
- To watch the tests run, `npx playwright test --headed`; to pick and replay
  them one by one, `npx playwright test --ui`. To skip the build while you
  work on the tests themselves, run `node e2e/serve.mjs` in a terminal of its
  own: the tests use that server while it's running. It builds as it starts,
  so restart it after you change the app.
- When you change something the tests click (a button's name, say, or what a
  screen says), update the test to match. When you add something people will
  use, add a test for it. If the app starts calling a new database function,
  the tests fail with "calls the fake Supabase has no answer for": add the
  function to `e2e/fake-supabase.ts`, roughly as the migration has it.
- To fix formatting, run the same prettier command with `--write` instead of
  `--check`. Keep to the folders above (or the files you've changed): the
  config files at the top of the repo have their own style.
- A failing database test prints the scenario's name, and what it expected
  against what it got.

## 4. Changing the database

Rules live in the migrations, so most gameplay changes are database changes.

- **Add a new file; never edit an old one.** Old migrations have already been
  run on the real database, and editing them changes nothing there. Name the
  new one with the next number, e.g. `0008_<what_it_does>.sql`, with a comment
  at the top saying what it changes and which migration it runs after.
- **It must run once, cleanly, on a database that's in use.** Each file runs
  as one transaction, so if anything fails, nothing changes. Think about rows
  that already exist: give new columns defaults, and fill them in for existing
  players where needed.
- **Write the scenario first.** Add tests to `supabase/tests/game.test.mjs` for
  what should now happen (and what should be refused), next to the related
  ones. The helpers at the top make players (`alice`, `bob`, `carol`), give
  them things (`give`, `setChips`), study (`study`) and move time on
  (`travel`). Run `npm run test:db` until they pass.
- **Then `npx supabase migration up`.** It applies just the new migration to
  your local Supabase, keeping its players and plots, so it's also the check
  that the migration upgrades a database in use. Then try the app.
- **Say so for the real project.** Migrations are run on the real database by
  hand, so a pull request with one needs a runbook step in `deployment/`
  (which file, in what order, and what to check afterwards).

## 5. Trying it by hand

```bash
npx expo start --web
```

This opens the app at `http://localhost:8081`. Changes reload as you save.
After changing `.env`, stop the server and start it again with `--clear`, or
the old values stick.

- **Two players:** `alice` in a normal window and `bob` in a private window (or
  another browser). The garden, the market, letters, desks and friends' cars
  all need two. Another address keeps its own sign-in too, so a third player
  can use `http://127.0.0.1:8081` in a window of its own.
- **The Test button** finishes a session at once, skips ahead in time (so
  crops grow and wither, and breaks run out), and gives chips, items and ripe
  crops. See [deployment/0002-testing-tools.md](../deployment/0002-testing-tools.md).
- **Weather and time of day:** add `?weather=clear|cloudy|windy|rain|storm|mist`
  and/or `?hour=0-23` to the address, e.g. `?hour=22&weather=rain` to check the
  night colours. This changes only what you see and hear.
- **A first day:** join as a new player with the invite `TESTJOIN`
  (**Got an invite? Join**), or with an invite made on the noticeboard. You'll
  see the welcome, the tips, and skipping the first session. The noticeboard's
  **Show the tips for new players again** brings the tips back for anyone.
- **Phone sizes:** the browser's developer tools have a device mode (in
  Chrome, F12, then the phone icon). It's good for layout, but try a real
  phone too, for touch, the thumbstick and sound.

### On your phone

1. Put the phone and the computer on a network that lets devices reach each
   other: home Wi-Fi, or the phone's own hotspot. University and other public
   Wi-Fi (eduroam, say) usually doesn't.
2. Find your computer's IP address on that network: `ipconfig getifaddr en0`
   on a Mac, or `ipconfig` on Windows (the IPv4 address).
3. The phone has to reach your local Supabase too, so in `.env` swap
   `127.0.0.1` for that address, e.g.
   `EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.20:54321`, and restart with
   `npx expo start --web --clear`.
4. On the phone, open `http://<that address>:8081`.
5. If the phone can't connect, the computer's firewall is probably in the way.
   On Windows, set the network to Private (Settings → Network & internet →
   Wi-Fi → the network), and allow Node.js and Docker Desktop for private
   networks (Windows Security → Firewall & network protection → Allow an app
   through firewall). On a Mac, allow them if it asks.
6. When you're done, put `127.0.0.1` back in `.env` (the address changes from
   network to network), and restart with `--clear`.

Over a plain `http://` address, browsers turn off two things that need a
secure page: keeping the screen awake during a session, and copying invite
links. Everything else works. To try those two, use the preview a pull
request gets (see *After you open it*), or `localhost` on a computer.

Sound starts after the first tap. On an iPhone it plays even on silent, and it
pauses other apps' music while it does. Focus is made for browsers first:
Expo Go runs it, but without sound.

### What to click through

The browser tests cover the main ways through as one player. Clicking through
yourself is for what they can't see: two players at once, realtime, how it
looks and sounds, and a real phone. Go through whatever your change touches,
and the places around it, in both windows. Every so often (and always for a
bigger change), do the whole round:

- [ ] **Join and sign in:** join with an invite, log out, sign in again.
      Logging out on a break counts as going home.
- [ ] **Car park:** friends at work show as their car or bike, the
      noticeboard opens, and the garden gate only works on a break.
- [ ] **Office:** you get a desk and the other player sees you at it. Start a
      session and watch the countdown. Give up. Start another and switch to
      another tab for over 10 seconds: it stops, and the office says so.
      **Test → Finish my session** pays out.
- [ ] **Payout:** chips are counted onto your desk and the break is shown.
      Take a break, go home, and spend chips all work.
- [ ] **Garden:** walk with the thumbstick and the arrow keys; the other
      player sees you move and hears your footsteps. Chat bubbles work both
      ways. Plant, water, look at, pick and clear a bed (using **Test → Ripen
      my crops** and the time skips). Water the other player's plot. Sell from
      your stall and buy from theirs. Use the basket (eat, save seeds, offer a
      swap), post a letter and pick it up in the other window, sit on a bench
      (the other player sees you sitting), throw something in a bin, and open
      the noticeboard. Walking out through the gate goes to the office, and
      when the break runs out a bell rings.
- [ ] **Shed:** buying something takes the chips, and it turns up where it
      should (in the car park, on your desk, or in your basket).
- [ ] **Sound:** after the first tap, the Sound button says **♪ Sound on**,
      each place sounds different, and muting works.
- [ ] **Looks:** at phone width nothing is cut off or overlapping and button
      labels fit, and the night colours (`?hour=22`) are readable.
- [ ] **No errors** in the browser's console (developer tools → Console).

## 6. Before you open the pull request

- [ ] `npm run lint`, `npm run typecheck`, `npx expo export --platform web`,
      `npm run test:db` and `npm run test:web` all pass.
- [ ] `npx prettier --check ...` is clean (section 3).
- [ ] You've clicked through what you changed, on a computer and on a phone,
      with two players where it matters.
- [ ] A new migration has the next number and tests in `game.test.mjs`, has
      gone onto your local Supabase with `npx supabase migration up`, and has
      a step in a `deployment/` runbook.
- [ ] If the game behaves differently, `README.md` and `docs/PLAN.md` say so.
- [ ] Nothing private or stray is committed: no `.env`, no `dist/`, no
      screenshots. `EXPO_PUBLIC_TESTING` is only ever in your local `.env`.

### After you open it

CI runs the same checks, and the pull request gets its own preview address:
open the **Deploy web** check's details on the pull request, and the address
is near the end of its log. The preview uses the **real** Supabase project
(the one in the repository's variables), not your local one. So:

- use it to see the change over `https` on your phone, and
- if the pull request adds a migration, its new features won't work in the
  preview until that migration has been run on the real database. Test those
  locally instead. Run the migration on the real database just before you
  merge, as the runbook says: until the merge, everyone is still on the old
  app.

## A hosted test project instead

If you'd rather test on a hosted Supabase project (to try a phone away from
home, say), make a second project and point `.env` at it. Supabase's free plan
allows two active projects across all your organisations, so with two already
running you'd pause one, or upgrade. In the new project's SQL Editor, run every
file in `supabase/migrations/` in number order, then `supabase/seed.sql` for
the same three test players. Under **Authentication → Sign In / Providers**,
turn sign-ups on and email confirmation off.

## Troubleshooting

- **`npx supabase start` says it can't connect to the Docker daemon:** Docker
  Desktop isn't running. Start it, wait until it says it's running, and try
  again.
- **`npx supabase start` says a port is already allocated:** something else
  is using Supabase's ports (54321 to 54324), often another local Supabase
  project. `npx supabase stop --all` stops every one of them.
- **`npx supabase start` (or a build) fails with "no space left on device":**
  the disk is full. Supabase's images need about 7 GB. Clearing npm's
  download cache (`npm cache clean --force`) frees a few GB safely.
- **A change to `.env` hasn't taken effect:** restart with
  `npx expo start --web --clear`.
- **"Failed to fetch" when signing in from a phone or another address:**
  `.env` still says `127.0.0.1`, which means "this computer" to every device.
  Put the computer's IP address there instead (see *On your phone*).
- **"Invalid login credentials" for alice:** the password is `focus-dev`. If
  the players have gone, `npx supabase db reset` brings them back (and clears
  everything else).
- **`test:db` says `ECONNREFUSED`:** the local Supabase isn't running
  (`npx supabase start`), or the Postgres in `DATABASE_URL` isn't.
- **`test:db` says `database "focus_test" is being accessed by other users`:**
  something (Studio, a database app, or another test run) still has it open.
  Close it and run again.
- **`test:web` says a browser "doesn't exist":** run
  `npx playwright install chromium` (again after Playwright is updated).
- **`test:web` stops before any test, saying the web server exited early:**
  something else is using port 8790. Stop it and run again.
- **`test:web` fails on something you've just fixed:** if a
  `node e2e/serve.mjs` is still running, the tests are using its older build.
  Stop it (Ctrl+C), and either start it again or leave the tests to build.
- **"already exists" when running a migration in a hosted project's SQL
  Editor:** that file has already been run on that database, and nothing
  changed. Run the next one.
- **The other player doesn't show up in the garden:** both have to be on a
  break with the garden open, and friends (the three test players all are).
- **No sound:** tap or click once first, then check the phone's volume. On an
  iPhone, check Focus itself isn't muted (the Sound button).
