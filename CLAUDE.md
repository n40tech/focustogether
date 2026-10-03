@AGENTS.md

# Focus

A calm, sound-first study game for a small group of friends: study at a desk in
the office, earn chips, and spend the break in a shared garden. Web first (a
static Expo export on EAS Hosting, deployed by GitHub Actions), with Supabase
behind it. The design pillars, rules, data model and decisions are in
`docs/PLAN.md`; how to test is in `docs/TESTING.md`; the steps for shipping
each update are in `deployment/`.

## How it fits together

- **The rules live in Postgres.** `supabase/migrations/` define
  security-definer functions (`set search_path = ''`, `auth.uid()`), and
  row-level security allows reads only. The app calls the functions with
  `supabase.rpc`, through the typed wrappers in `src/lib/api.ts`. A player's
  status (focused, on_break, idle, absent) is worked out in `private.presence`,
  and sessions finish lazily in `private.finalize_expired`.
- **Places** are screens in `src/app/(app)/`: the car park (`index`), office,
  payout, garden, the shed (`shop`) and the noticeboard (`friends`). While a
  session runs, only the office exists (`Stack.Protected` in
  `src/app/(app)/_layout.tsx`).
- **The garden** is walkable (`src/world/useWalker.ts`, `gardenMap.ts`).
  Friends' positions and chat go over private Realtime channels named
  `garden:<username>` (`src/world/useGardenChannel.ts`).
- **Leaving the page** mid-session stops the session after 10 seconds' grace
  (`src/lib/away.ts`).
- **Sound** is synthesised with Web Audio (`src/audio/engine.web.ts`; native is
  a silent stub). The **weather** is a function of the clock (`src/weather`).
  The **art** is placeholder shapes on a 360×640 stage, seen from above and in
  front, with no sky (`src/art`).

## Rules

- **Database changes go in a new migration** with the next number
  (`0008_<what_it_does>.sql`, and so on). Never edit an old one: they've already
  been run on the real database. Each new file is run there by hand, once, in
  the SQL Editor, so it must work as one transaction on a database that's in
  use. Write its scenario tests in `supabase/tests/game.test.mjs` first, and add
  a step for it to a runbook in `deployment/`.
- **Leave the real Supabase project ("focus-app") alone** unless asked: no
  `supabase link`, nothing with `--linked`, and no SQL or writes through a
  Supabase connector. Test on the local Supabase instead (`npx supabase start`;
  the players `alice`, `bob` and `carol` have the password `focus-dev`).
- **`EXPO_PUBLIC_TESTING` only ever goes in a local `.env`**: never in GitHub's
  variables, a workflow, or a deployed build.
- **Don't open a pull request unless asked.**
- **Expo:** as `AGENTS.md` says, look up the SDK 57 docs before using an Expo
  or React Native API that isn't already in the repo, and add packages with
  `npx expo install`.
- **Tests:** game rules are scenarios in `supabase/tests/game.test.mjs`
  (`npm run test:db`). Screens are click-throughs in `e2e/` (`npm run
  test:web`), against a pretend Supabase in `e2e/fake-supabase.ts`: when the
  app calls a new database function, add it there too. When a change alters
  something a test clicks or reads, update the test; a new feature gets a test.
- **Before calling anything done:** `npm run lint`, `npm run typecheck`,
  `npx expo export --platform web`, `npm run test:db` and `npm run test:web`
  all pass. Then click through it as `docs/TESTING.md` describes.
- **Formatting:** Prettier with `.prettierrc.json`, on `src/`,
  `supabase/tests/` and `e2e/` only.
- **Writing** (UI text, docs, commit messages): plain, calm British English, in
  short sentences. Keep to the design pillars in `docs/PLAN.md`: no
  leaderboards, badges, feeds, red dots or confetti.
