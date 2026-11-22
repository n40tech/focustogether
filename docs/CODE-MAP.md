# Code map

A quick way into the code, for anyone (Claude included) picking up work
here. `docs/PLAN.md` says what the game does and why; this says where it
lives. Keep it current: when you add a migration, a database function, a
screen or a module, change the tables below.

## How a change usually goes

1. **Rules** go in a new migration, `supabase/migrations/00NN_<what>.sql`,
   with scenario tests in `supabase/tests/game.test.mjs` (`npm run test:db`).
   Copy a function's latest body (see *Database functions*) and change it;
   start its comment with "As in 00NN, plus …".
2. **API**: types and a wrapper in `src/lib/api.ts`, and the same function in
   `e2e/fake-supabase.ts` (the click-through tests fail on calls it doesn't
   know).
3. **Screens** in `src/app/(app)/`, pieces in `src/components/` and
   `src/world/`, drawing in `src/art/`.
4. **Click-throughs** in `e2e/*.spec.ts` (`npm run test:web`).
5. **Docs**: `docs/PLAN.md` (places, rules, the data model and RPC tables,
   milestones, decisions), `docs/TESTING.md`, `README.md`, a runbook in
   `deployment/`, and this file.

## The app

| Where | What |
|---|---|
| `src/app/_layout.tsx` | Signed in or not: `(app)` or `login`. Reads an invite code from the address before the router rewrites it. |
| `src/app/login.tsx` | Sign in, and the Join form (invite code, username, name, email, password). |
| `src/app/(app)/_layout.tsx` | `WorldProvider`, the places (only the office while you study), the payout prompt, and opening an invite once you're in. |
| `src/app/(app)/index.tsx` | The car park: driving in, parking, walking about, smoking, crashes and claims. |
| `src/app/(app)/office.tsx` | Desks, joining friends, arranging your desk; `StudyPanel` at the bottom. |
| `src/app/(app)/payout.tsx`, `garden.tsx`, `shop.tsx`, `friends.tsx` | The payout, the garden, the shed (with repairs and insurance) and the Friends board. |
| `src/components/StudyPanel.tsx` | Picking a length, the countdown, the study invite, and (on a break) back to the garden. |
| `src/components/Header.tsx` | `SceneHeader`: the Friends, sound and weather icons; your break, chips and the settings cog. |
| `src/components/Icons.tsx` | The header's icons, drawn from shapes. |
| `src/components/Settings.tsx` | The settings sheet: sound sliders, keep playing sounds, hard mode, friends of friends, notifications (`Notifications.tsx`), your email (`EmailBox.tsx`), log out. `openSettings` in `Header.tsx` opens it from a tip. |
| `src/components/Noticeboard.tsx` | The Friends board: friends, requests and invites. |
| `src/components/Steering.tsx` | The thumbstick on a touchscreen; on a computer, the keys to press. |
| `src/components/Walkabout.tsx` | Shared by the garden and the car park: `Pan`, `Follow`, `Label`, `ChatBar`, `useLit`. |
| `src/world/World.tsx` | `useWorld()`: you, friends, friends of friends and looks, polled every 10 s. `useGo()` moves between places. |
| `src/world/useWalker.ts` | Walking (and, with `driving`, driving) with the stick or keys, the camera, collisions. |
| `src/world/useGardenChannel.ts` | Realtime positions and chat, for the garden or (with `CHANNELS`) the car park. |
| `src/world/gardenMap.ts`, `carParkMap.ts` | Each place's layout and what blocks you. `carParkMap` also says where you can park (`parkingSpot`: a free bay, or a rack slot for a bike). |
| `src/world/seats.ts` | Who sits at which desk (and the bay that goes with it). |
| `src/lib/api.ts` | Every type the server returns, and `api.*` wrappers for each RPC. |
| `src/lib/away.ts` | Hard mode: telling the server when the page is left, and keeping the screen on. |
| `src/lib/invites.ts` | Invite codes, links, sharing, and the invite waiting to be opened. |
| `src/lib/email.ts`, `username.ts` | Mirrors of the database's email and username rules. |
| `src/lib/prefs.ts` | Settings kept on this device (sound's are in `src/audio/sound.ts`). |
| `src/lib/birth.ts` | The sign-up form's date of birth: typing it day first, and checking it's real. |
| `src/art/` | Placeholder drawing on the 360 × 640 stage: `Scene`, `primitives`, `Vehicles` (with damage), `People`, `Office`, `Garden`. |
| `src/audio/` | Synthesised sound (`engine.web.ts`); add a sound to `types.ts` and the engine's `play`. The settings sliders (`SoundLevels`) scale the engine's layers in its `tick`. |

## The website

| Where | What |
|---|---|
| `site/index.html` | The one-page website (GitHub Pages, `.github/workflows/pages.yml`): the car park and the arrow, the office and the buzzer, the garden and the invite from `website_invite`. Plain HTML, CSS and JavaScript. |
| `site/assets/scenes/` | Its pictures of the game, and `stage.json`, which says where the game's stage is in each. Made by `npm run site:shots` (`scripts/site-shots.spec.ts`), from the browser tests' build and pretend Supabase. Take them again when the art changes. |

## Database tables

Read-only through row-level security; everything else goes through
functions. `profiles` has grown in most migrations: see the data model in
`docs/PLAN.md`, section 9.

`profiles`, `sessions`, `friendships`, `friend_requests`, `items`, `crops`,
`inventory`, `plots` (with the view `private.beds`), `trades`, `listings`,
`invites`, `letters`, `desk_layout`, `push_subscriptions`, `emails`,
`crashes`, `birthdays` (no policies: nobody reads it directly).

## Database functions

Which migration last defined each one: copy from there.

Public (called by the app with `supabase.rpc`):

| Migration | Functions |
|---|---|
| 0001 | `cancel_session`, `leave` |
| 0002 | `cancel_trade`, `offer_trade`, `respond_trade`, `save_seeds` |
| 0003 | `buy_listing`, `create_invite`, `eat`, `get_garden`, `get_invites`, `list_item`, `unlist` |
| 0005 | `dev_chips`, `dev_item` |
| 0006 | `arrive`, `dev_ripen`, `water`, `water_friend` |
| 0007 | `bin_item`, `clear_bed`, `dev_skip`, `done_tip`, `get_post`, `harvest`, `pick_up_post`, `plant`, `reset_tips`, `send_letter` |
| 0008 | `remove_friend` |
| 0009 | `skip_first_session` |
| 0010 | `add_friend`, `answer_friend_request`, `get_friend_requests`, `withdraw_friend_request` |
| 0011 | `switch_desk` |
| 0012 | `get_looks`, `set_looks` |
| 0013 | `place_desk_item`, `store_desk_item` |
| 0014 | `get_profile` |
| 0015 | `drop_push`, `due_pushes`, `forget_pushes`, `save_push` |
| 0017 | `back_to_page`, `buy`, `buy_insurance`, `check_signup`, `claim_crash`, `crash`, `get_friends_board`, `get_friends_of_friends`, `go_home`, `invite_to_session`, `join_session`, `leave_page`, `may_listen`, `repair_vehicle`, `set_email`, `set_hard_mode`, `set_place`, `start_session`, `use_invite` |
| 0018 | `park` |
| 0019 | `bump` |
| 0020 | `website_invite` (anyone, signed in or not) |
| 0021 | `get_me`, `get_shop`, `smoke` |

Private (helpers; the app can't call them):

| Migration | Functions |
|---|---|
| 0001 | `require_uid` |
| 0002 | `break_minutes`, `inventory_of`, `is_tradeable`, `require_not_studying`, `require_on_break`, `status_of`, `take_item` |
| 0003 | `assign_plot_slot`, `desk_of`, `make_invite`, `new_invite_code`, `stall_of` |
| 0004 | `keeps_for` |
| 0005 | `require_tester` |
| 0006 | `growth_at`, `moist_for`, `ripe_moment`, `water_beds`, `watered_speed` |
| 0007 | `away_grace`, `finalize_expired`, `plots_of`, `post_of`, `smoke_for` |
| 0008 | `is_username`, `normal_username`, `username_key` |
| 0010 | `befriend`, `friends_in_common` |
| 0011 | `arrive`, `circle_of`, `friends_of_friends` |
| 0012 | `is_looks` |
| 0013 | `desk_items_of` |
| 0016 | `streak` |
| 0017 | `crashes_of`, `insurance_lasts`, `insurance_price`, `invite_studying_until`, `is_email`, `normal_email`, `presence`, `repair_cost` |
| 0021 | `add_item` (refuses cigarettes to under-18s), `on_signup` (the sign-up trigger), `under_18` |

Rebuild these tables with a short script: for each migration in order, find
`create (or replace) function (public|private).<name>`; the last file wins.

Things to know when writing one:

- `get_me` is replaced whenever it gains a field. So are `get_friends_board`
  and `get_friends_of_friends`. Copy the latest whole.
- New public functions need `revoke … from public, anon` and
  `grant … to authenticated` at the end (`check_signup` is also for `anon`).
  Private ones need nothing: the schema is closed.
- Changing a function's arguments means `drop function` first (see
  `check_signup` in 0017); a default keeps older apps' calls working.
- On the real database, the migration can `drop` and `create` policies on
  `realtime.messages` but not `alter` them (it isn't the owner). The test
  stubs don't catch that; rehearsing locally does.
- Each file runs once, as one transaction, on a database in use.

## Keeping it quick

- `usePolled` ignores a poll that brings back what it had (bar
  `server_now`), so nothing redraws for it. Keep it that way: a whole place
  redrawing every few seconds stutters on slower laptops.
- What a place draws that never changes (the car park's office, bays and
  lamp posts) is a `memo` component, so other changes don't redraw it.
- Walking and driving move Animated values directly; nothing re-renders as
  you move. Keep per-frame work out of React state.
- To measure: drive a Playwright page with the CPU slowed
  (`Emulation.setCPUThrottlingRate`), and watch long tasks and frame times.

## Tests

- **`supabase/tests/game.test.mjs`** builds a scratch database from every
  migration. `beforeEach` empties the game tables and resets `profiles`: add
  new tables and columns there. `travel(minutes)` moves every timestamp back
  (add new timestamp columns to it). `signUp()` gives each player an email.
  The tests at the end sign up new players and change friendships, so they
  come last.
- **`e2e/`** runs the web build in Chromium at phone size against
  `e2e/fake-supabase.ts`. `fake.me` and `fake.friends` set the scene;
  `fake.called('fn')` lists the calls. `walk(page, key, ms)` holds an arrow
  key on a paused clock (it drives, too). `ALL_TIPS` lists every tip: add new
  ones, or tests will see them.

## Running it here

- `npx supabase start` (Docker Desktop first). `.env` points at it, with
  `EXPO_PUBLIC_TESTING=true`. Apply a new migration locally with
  `npx supabase migration up --local`.
- If `npx expo start --web` never starts listening, use the export instead:
  `npx expo export --platform web`, then serve `dist/` (`e2e/serve.mjs`
  shows how), and drive it with a small Playwright script for screenshots.
  Headless Playwright is also steadier than the app's browser pane for
  two-player checks.
