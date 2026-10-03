# Testing Focus before a pull request

How to check a change on your own machine before you open a pull request. It's
the same every time. Sections 1 and 2 are one-off setup, and the checklist at
the end is what to tick off before each pull request.

Short version, once you're set up:

```bash
npm run lint
npm run typecheck
npx expo export --platform web           # the web build CI makes
npm run test:db                          # needs Postgres running (section 2)
npx prettier --check "src/**/*.{ts,tsx}" "supabase/tests/*.mjs"
npx expo start --web                     # then click through (section 5)
```

The first four are what CI runs on every pull request, so if they pass here
they'll pass there. Formatting isn't checked by CI, but keeping to it keeps
your diffs to what you changed.

---

## 1. A Supabase project just for testing (one-off)

Don't test against the real project: your friends' chips, plots and letters
are in it, and the testing tools move time for whoever uses them. Make a
second, free project (Supabase allows two) and point your local app at it.

1. [supabase.com](https://supabase.com) → **New project**, called something like
   `focus-dev`. Any region and password.
2. **SQL Editor → New query**: paste and run every file in
   `supabase/migrations/`, one at a time, in number order (`0001_init.sql`
   first). Each runs once.
3. **Authentication → Sign In / Providers**: turn **Allow new users to sign up**
   on and **Confirm email** off, then **Save**.
4. **SQL Editor**: `select private.make_invite();` gives you an invite code.
5. Put the project's values in `.env` (copy `.env.example`; both values are
   under the dashboard's **Connect** button), plus the testing switch:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<dev-project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   EXPO_PUBLIC_TESTING=true
   ```
   `.env` is never committed (it's in `.gitignore`), and deploys get their
   values from GitHub, so none of this reaches the real site. (If you ever
   deploy by hand with `npx eas-cli@latest deploy`, switch `.env` back to the
   real project and remove `EXPO_PUBLIC_TESTING` first.)
6. `npm install`, then `npx expo start --web`. Join with the invite
   (**Got an invite? Join**), then make a second player: on the first one's
   noticeboard, **Make an invite**, and open the link in a private window.
7. Make both of them testers, so they get the **Test** button:
   ```sql
   update public.profiles set tester = true;
   ```

Free projects pause after a week without use. If yours has, press **Restore**
in the dashboard.

## 2. Postgres for the database tests (one-off)

`npm run test:db` runs the game's rules (every function in the migrations)
against a plain local Postgres 16. It makes a scratch database called
`focus_test`, builds it from the migrations, and drops it again next run. It
never touches Supabase. Pick one way to get Postgres:

- **Docker** (any OS): `docker run --name focus-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`.
  Afterwards it's `docker start focus-pg`.
- **macOS**: [Postgres.app](https://postgresapp.com), or
  `brew install postgresql@16 && brew services start postgresql@16`.
- **Windows**: the installer from [postgresql.org](https://www.postgresql.org/download/windows/).
  Remember the password you give the `postgres` user.

The tests connect with `DATABASE_URL`, which defaults to
`postgres://postgres:postgres@localhost:5432/postgres` (the Docker setup). If
yours differs, set it first:

```bash
# macOS / Linux
DATABASE_URL=postgres://postgres:<password>@localhost:5432/postgres npm run test:db
# Windows PowerShell
$env:DATABASE_URL="postgres://postgres:<password>@localhost:5432/postgres"; npm run test:db
```

(With Postgres.app or Homebrew, the user is usually your own login name with
no password: `postgres://<you>@localhost:5432/postgres`.)

## 3. The automated checks

| Command | Checks | In CI |
|---|---|---|
| `npm run lint` | ESLint with Expo's rules, including React's rules for hooks | yes |
| `npm run typecheck` | TypeScript | yes |
| `npx expo export --platform web` | the web build: every page builds | yes |
| `npm run test:db` | the game rules, as scenarios (`supabase/tests/game.test.mjs`) | yes |
| `npx prettier --check "src/**/*.{ts,tsx}" "supabase/tests/*.mjs"` | formatting (the style is in `.prettierrc.json`) | no |

- `npx expo export` writes to `dist/`, which is gitignored. Delete it when
  you're done if you like.
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
- **It must run once, cleanly, on a database that's in use.** Postgres runs a
  file pasted into the SQL Editor as one transaction, so if anything fails,
  nothing changes. Think about rows that already exist: give new columns
  defaults, and fill them in for existing players where needed.
- **Write the scenario first.** Add tests to `supabase/tests/game.test.mjs` for
  what should now happen (and what should be refused), next to the related
  ones. The helpers at the top make players (`alice`, `bob`, `carol`), give
  them things (`give`, `setChips`), study (`study`) and move time on
  (`travel`). Run `npm run test:db` until they pass.
- **Then run it on your dev project** (SQL Editor) before trying the app. Your
  dev project already has players and plants in it, so this is also the check
  that it upgrades a database in use.
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

- **Two players:** one in a normal window and one in a private window (or
  another browser), signed in as different players. The garden, the market,
  letters, desks and friends' cars all need two.
- **The Test button** (with `EXPO_PUBLIC_TESTING=true`, for testers) finishes
  a session at once, skips ahead in time (so crops grow and wither, and breaks
  run out), and gives chips, items and ripe crops. See
  [deployment/0002-testing-tools.md](../deployment/0002-testing-tools.md).
- **Weather and time of day:** add `?weather=clear|cloudy|windy|rain|storm|mist`
  and/or `?hour=0-23` to the address, e.g. `?hour=22&weather=rain` to check the
  night colours. This changes only what you see and hear.
- **A first day:** the noticeboard's **Show the tips for new players again**
  brings the tips back. For the whole first day, including skipping the first
  session, join as a brand-new player with a fresh invite.
- **Phone sizes:** the browser's developer tools have a device mode (in
  Chrome, F12, then the phone icon). It's good for layout, but try a real
  phone too, for touch, the thumbstick and sound.

### On your phone

With `npx expo start --web` running, put the phone on the same Wi-Fi and open
`http://<your computer's IP address>:8081`. To find the address, run
`ipconfig getifaddr en0` on a Mac, or `ipconfig` on Windows (look for the
IPv4 address). If your computer asks whether to let Node accept incoming
connections, allow it.

Over a plain `http://` address, browsers turn off two things that need a
secure page: keeping the screen awake during a session, and copying invite
links. Everything else works. To try those two, use the preview a pull
request gets (see *After you open it*), or `localhost` on a computer.

Sound starts after the first tap. On an iPhone it plays even on silent, and it
pauses other apps' music while it does. Focus is made for browsers first:
Expo Go runs it, but without sound.

### What to click through

Go through whatever your change touches, and the places around it, in both
windows. Every so often (and always for a bigger change), do the whole round:

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

- [ ] `npm run lint`, `npm run typecheck`, `npx expo export --platform web`
      and `npm run test:db` all pass.
- [ ] `npx prettier --check ...` is clean (section 3).
- [ ] You've clicked through what you changed, on a computer and on a phone,
      with two players where it matters.
- [ ] A new migration has the next number, tests in `game.test.mjs`, has been
      run on your dev project, and has a step in a `deployment/` runbook.
- [ ] If the game behaves differently, `README.md` and `docs/PLAN.md` say so.
- [ ] Nothing private or stray is committed: no `.env`, no `dist/`, no
      screenshots. `EXPO_PUBLIC_TESTING` is only ever in your local `.env`.

### After you open it

CI runs the same checks, and the pull request gets its own preview address:
open the **Deploy web** check's details on the pull request, and the address
is near the end of its log. The preview uses the **real** Supabase project
(the one in the repository's variables), not your dev project. So:

- use it to see the change over `https` on your phone, and
- if the pull request adds a migration, its new features won't work in the
  preview until that migration has been run on the real database. Test those
  on your dev project instead. Run the migration on the real database just
  before you merge, as the runbook says: until the merge, everyone is still
  on the old app.

## Troubleshooting

- **A change to `.env` hasn't taken effect:** restart with
  `npx expo start --web --clear`.
- **`test:db` says `ECONNREFUSED`:** Postgres isn't running, or isn't on port
  5432. With Docker: `docker start focus-pg`.
- **`test:db` says `password authentication failed`:** `DATABASE_URL` has the
  wrong user or password for your Postgres (section 2).
- **`test:db` says `database "focus_test" is being accessed by other users`:**
  something (a database app, or another test run) still has it open. Close it
  and run again.
- **"already exists" when running a migration:** that file has already been
  run on that database, and nothing changed. Run the next one.
- **The other player doesn't show up in the garden:** both have to be on a
  break with the garden open, signed in to the same project, and friends.
- **No sound:** tap or click once first, then check the phone's volume. On an
  iPhone, check Focus itself isn't muted (the Sound button).
