# Focus — game plan

A calm, sound-first study game for a small group of friends. You "go to work"
together: you study at your desk in a shared office, earn poker chips for every
minute you focus, and spend your breaks in a shared allotment garden where you
can chat, smoke and tend your crops.

This is a living document. The **Decisions** section records what has been
agreed; **Open questions** lists what hasn't.

---

## 1. Design pillars

1. **One place at a time.** The car park, the office and the garden are separate
   full screens. While a session runs, the office is the only place that exists.
2. **Calm over clever.** Muted palettes, slow motion, no badges, feeds, red dots
   or confetti. The timer is the only number that changes while you study.
3. **Sound is the world.** The shared weather is something you *hear*: rain on
   the office window, wind through the allotments, birds when it clears.
4. **Presence, not pressure.** You see friends' cars, desks and avatars. There
   are no leaderboards and nobody else's chip count.

## 2. The loop

```
              open the app
                   │
                   ▼
   ┌───────────────────────────┐   walk in    ┌──────────────────────┐
   │         CAR PARK          │ ───────────▶ │        OFFICE        │
   │ friends' cars & bikes     │              │ set a timer, study   │
   │ (if they're at work)      │ ◀─────────── │ friends at desks     │
   └───────────────────────────┘   walk out   └──────────┬───────────┘
          ▲            ▲                                 │ timer ends
          │            │ go home              ┌──────────▼───────────┐
          │            └───────────────────── │        PAYOUT        │──▶ SHOP
          │                                   │ chips + earned break │
          │ go home                           └──────────┬───────────┘
          │                                              │ take a break
          │                                   ┌──────────▼───────────┐
          └────────────────────────────────── │        GARDEN        │
                                              │ chat, smoke, allot-  │
                         back to work ◀────── │ ment; bell when the  │
                         (office)             │ break is over        │
                                              └──────────────────────┘
```

## 3. Places

### Car park (where the app opens)
- **See:** the office building and its door, a parking bay per friend and a bike
  rack. Friends who are *at work* (studying, on a break, or just between the
  two) appear as their **car** in a bay or their **bike** in the rack. Friends
  with neither aren't shown. Your own bay stays empty until you buy a vehicle.
- **Do:** walk in (office) · the kiosk (shop) · the noticeboard (friends) · the
  garden gate (only while you're on a break) · log out.
- **Hear:** open-air weather, distant traffic.

### Office
- **See:** your desk at the front with everything you've bought for it, and a
  desk per friend: someone sitting at it if they're studying, empty if not. A
  window shows the shared sky.
- **Do, before a session:** choose a length (1–120 min) and start, or walk out.
- **Do, during a session:** nothing else. There's the countdown and a small
  *give up* link, which forfeits the session. The chip balance, shop and all
  navigation are hidden.
- **Hear:** a soft room tone, the weather muffled through the window, rain
  tapping on the glass.

### Payout (end of a session)
- **See:** chips counted out (1 per minute) and the break you've earned.
- **Do:** *Take a break* (garden) · *Go home* (car park) · *Spend chips* (shop).
- **Hear:** a soft bell, then chips clinking.

### Garden (on a break)
- **See:** an allotment plot for you and one for each friend, with crops at
  their growth stage. Friends on a break stand at their plots, with Club
  Penguin-style chat bubbles over their heads and smoke if they're having a
  cigarette. A quiet break timer.
- **Do:** say something · water your beds · plant · harvest · eat a crop or save
  its seeds · offer a trade · smoke · *Back to work* (office) · *Go home*.
- **Hear:** the weather in full, birds when it's dry, crickets at night, wind
  chimes when it gusts.
- When the break runs out, a bell rings and you choose the office or home.

### Shop (the kiosk)
Reached from the payout screen, the car park kiosk or the garden. It's never
available during a session.

### Friends (the noticeboard)
Add a friend by username and see where everyone is.

## 4. Rules

### Status
Derived on the server from timestamps and never stored, so it can't drift.

| Status | When | Car park | Office | Garden |
|---|---|---|---|---|
| `focused` | a session is running | vehicle shown | at their desk | – |
| `on_break` | finished a session less than their earned break ago, and hasn't gone home | vehicle shown | empty desk | at their plot |
| `idle` | up to 10 min after a break (or a given-up session) ends | vehicle shown | empty desk | – |
| `absent` | otherwise, or they went home | – | empty desk | – |

### Sessions, chips and breaks
- Sessions last 1–120 minutes. Completing one earns **1 chip per minute**.
  Giving up earns nothing, and no break.
- **Earned break: 1 minute per 5 studied** (at least 1). So 25 min earns 5,
  50 earns 10, 90 earns 18 and 120 earns 24.
- When the break runs out, a soft bell rings and you choose office or home.
  Starting a new session ends a break early; going home ends it too.

### Shop catalogue (placeholder prices, tuned to ~1 chip per minute)

| Kind | Items (chips) |
|---|---|
| Vehicles | Bicycle 60 · Hatchback 300 · Estate 500 · Campervan 800 · Vintage roadster 1200 |
| Desk | Mug 10 · Rubber duck 15 · Succulent 20 · Photo frame 30 · Desk lamp 40 · Lava lamp 60 · Radio 80 · Bonsai 150 |
| Seeds (packet of 3) | Radish 6 · Carrot 8 · Sunflower 10 · Strawberry 12 · Tomato 15 · Pumpkin 25 |
| Cigarettes | Pack of 5 · 8 |

Vehicles and desk items are one-offs. Buying a vehicle makes it the one you
arrive in. The catalogue is one table (`items`), so prices are tuned without
touching code.

### Allotment
- Every player has a plot with **4 beds**.
- Plant a seed in an empty bed. **Crops grow by the minutes you study**, but
  only in beds watered within the last 24 hours. When it's raining and you're in
  the garden, the rain waters them for you.
- Nothing dies; an unwatered bed just pauses.
- A ripe crop is harvested into your basket as produce. **Produce is never
  exchanged for chips.** You can:
  - **eat** it (for now your avatar has a snack; see open questions),
  - **save seeds** from it (one crop gives 2–6 seeds of its kind),
  - **trade** it with a friend.

| Crop | Study minutes to ripen | Harvest | Seeds saved per crop |
|---|---|---|---|
| Radish | 25 | 3 | 2 |
| Carrot | 50 | 3 | 2 |
| Strawberry | 90 | 4 | 2 |
| Tomato | 120 | 4 | 3 |
| Sunflower | 180 | 1 | 6 |
| Pumpkin | 300 | 1 | 4 |

### Trades
- Offer some produce, seeds or cigarettes to a friend, optionally asking for
  something back. Asking for nothing makes it a gift.
- The offered items are held in escrow until your friend accepts or declines,
  or you withdraw the offer, so nobody can be short-changed.
- Offers are made and answered in the garden, never during a session.

### Cigarettes
Smoked in the garden, one at a time. Your friends see about 5 minutes of smoke
and hear a lighter flick and a quiet crackle.

### Chat
Messages of up to 80 characters appear as a bubble over your head for a few
seconds, Club Penguin style. Only friends who are in the garden at that moment
see them, and nothing is stored.

## 5. Weather

- One **shared, deterministic** weather cycle computed from the clock.
  Everyone sees and hears the same sky at the same moment, with no server or
  API involved.
- Smooth value noise on several time scales (hours, ~30 min, ~10 min) produces
  `cloud`, `rain`, `wind`, `storm` and `fog`, each from 0 to 1. Rain only falls
  under heavy cloud, storms need heavy rain and strong wind, and fog settles on
  still mornings.
- Time of day (sky colour, sun or moon, birds or crickets) follows each
  player's own clock.
- It lives in `src/weather/`. The same function can be ported to SQL or an Edge
  Function if the server ever needs it, for example so rain waters plots while
  nobody is looking.

## 6. Sound

Procedural for now (Web Audio API, no audio files). Each layer is driven by a
weather or scene parameter, so recorded loops can replace layers one at a time
later.

| Layer | Driven by | Where |
|---|---|---|
| Rain hiss and drops | `rain` | outdoors; muffled, plus taps on the glass, indoors |
| Wind and gusts | `wind` | outdoors; faint indoors |
| Thunder | `storm` | everywhere, muffled indoors |
| Birds / crickets | dry daylight / dry night | garden, car park |
| Wind chimes | gusts | garden |
| Traffic rumble | — | car park |
| Room tone | — | office |

- One-shots: door, bell, chips, lighter, watering can, bubble pop, harvest,
  purchase.
- Scenes crossfade over about 2 s. Indoors, the weather passes through a
  low-pass "window" filter. Weather changes ramp over about 10 s, so the sound
  never jumps.
- Browsers only allow audio after a tap; the first tap anywhere unlocks it.
  Mute and volume are remembered per device.
- On native (later), either `react-native-audio-api` (a Web Audio
  implementation, so the same engine runs) or `expo-audio` with recorded loops.

## 7. Visual calmness rules

- Each place is a full-screen scene with its own muted palette. Scenes fade in;
  they never slide.
- No scrolling feeds, badges, red dots or confetti. The chip balance is hidden
  while studying.
- Motion is slow and ambient: rain, drifting clouds, smoke. Lightning is a
  gentle brightening, never a strobe. With *reduce motion* turned on, the
  weather is drawn still.
- UI chrome is a thin header (place, chips, sound) and a bottom action panel.
- Placeholder art is built from simple shapes on a fixed 360×640 "stage" that
  scales to any screen. Real illustrations can replace pieces later without
  changing scene layout code.

## 8. Architecture

```
src/
  app/                    routes: one file per place (Expo Router)
    _layout.tsx           auth gate
    login.tsx
    (app)/_layout.tsx     world state + the "studying locks you in the office" rule
    (app)/index.tsx       car park
    (app)/office.tsx      office + timer
    (app)/payout.tsx      end of session
    (app)/garden.tsx      garden
    (app)/shop.tsx        kiosk
    (app)/friends.tsx     noticeboard
  world/                  client game state (polling, scene guards)
  weather/                shared weather algorithm + sky colours
  audio/                  sound engine: engine.web.ts (Web Audio), engine.ts (native stub)
  art/                    placeholder art: stage, sky, vehicles, desks, people, beds
  components/             UI pieces: buttons, header, timer, chat bubble, sheets
  lib/                    Supabase client, typed RPC wrappers, catalogue art, time
supabase/migrations/      0001 init (MVP), 0002 game
```

- **The server is the source of truth** for anything that matters: chips,
  status, inventory, plots and trades. Clients never write tables. Every change
  is a security-definer Postgres function using `auth.uid()`, and RLS only
  allows reads.
- **Polling:** the world polls `get_me` and `get_friends_board` every 10 s and
  when the app regains focus. The garden polls `get_garden` every 5 s.
- **Chat:** Supabase Realtime Broadcast on private channels named
  `garden:<username>`. RLS on `realtime.messages` lets you listen to your own
  and your friends' channels, and speak only on your own.
- **Clock:** every RPC returns `server_now` and the client corrects its
  countdowns with it.
- **Routing:** while a session runs, every place except the office is removed
  from the navigator (`Stack.Protected`), so deep links and the back button
  can't escape the office.

## 9. Data model and API

| Table | Holds |
|---|---|
| `profiles` | + `chips` (was `points`), `went_home_at` (was `left_at`), `vehicle`, `activity`, `activity_until` |
| `sessions` | unchanged |
| `friendships` | unchanged |
| `items` | catalogue: slug, kind, name, price, pack size |
| `crops` | per crop: its seed, study minutes to ripen, harvest size, seeds saved |
| `inventory` | (player, item) → quantity |
| `plots` | (player, bed 0–3) → crop, planted at, growth, last watered |
| `trades` | offers in escrow: what's given, what's wanted, status |

| RPC | Allowed when | Returns |
|---|---|---|
| `get_me`, `get_friends_board`, `add_friend` | signed in | me / friends |
| `start_session(minutes)` | not studying | me |
| `cancel_session()` | studying | me |
| `go_home()` | on a break or idle | me |
| `get_shop()`, `buy(item)` | not studying | shop |
| `get_garden()` | signed in | garden |
| `plant(bed, seed)`, `water()`, `harvest(bed)` | on a break | garden |
| `eat(item)`, `save_seeds(item)`, `smoke()` | on a break | garden |
| `offer_trade(...)`, `respond_trade(id, accept)` | on a break | garden |
| `cancel_trade(id)` | signed in | garden |

## 10. Web deployment stack

| Layer | Choice | Why |
|---|---|---|
| App | Expo SDK 57, Expo Router, React Native Web | One codebase: web now, iOS and Android later |
| Web build | `npx expo export -p web` with `web.output: "static"` | Every route gets its own HTML file, so refreshing `/garden` works on any static host |
| Hosting | **EAS Hosting** (`eas deploy`), served at `https://<name>.expo.app` | The project is already linked to EAS; free tier; a preview URL per deploy; custom domain later |
| Backend | **Supabase**: Postgres, Auth, Realtime | Already in use. RLS and RPCs keep the rules server-side, and Realtime Broadcast carries chat |
| CI | GitHub Actions: lint, typecheck and web export on every push and PR | |
| CD | GitHub Actions: `eas deploy --prod` on push to `main`, a preview deploy for each PR | |
| DB migrations | SQL files in `supabase/migrations/`, run in the SQL editor (or `supabase db push`) | |

**Secrets and variables (GitHub → Settings → Secrets and variables → Actions)**
- Secret `EXPO_TOKEN`: an access token from expo.dev (Account settings → Access
  tokens).
- Variables `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  These are public by design, because they're baked into the JavaScript bundle.
  RLS is what protects the data.

Free tiers of EAS Hosting and Supabase comfortably cover a friend group.

## 11. Milestones

**M1: playable placeholder (this branch)**
- [x] Plan (this document)
- [x] Static web export so deep links survive a refresh
- [ ] Migration `0002_game.sql`: chips, earned breaks, shop, vehicles, desk,
      allotment, produce, cigarettes, trades, garden chat policies
- [ ] Shared weather algorithm
- [ ] Procedural sound engine (web)
- [ ] Scenes: car park, office, payout, garden, shop, friends
- [ ] CI and EAS Hosting deploy workflows

**M2: feel**
- Illustrated art, recorded audio (layer by layer), a typeface, gentle
  character animation.
- Presence: show who is actually looking at the garden right now (Realtime
  Presence).
- Server-side weather, so rain waters everyone's plots.
- "Session over" and "break over" notifications (web push on web).
- Self-serve sign-up and invites. Accounts are created by hand in the
  Supabase dashboard today.
- Effects for eating, arranging your desk, and choosing which owned vehicle
  to arrive in.

**M3: native apps**
- Development build (`eas build --profile development`), the native audio
  engine, keep-awake while studying, local notifications.
- Store builds and submission (`eas build`, `eas submit`), including the
  content rating for tobacco references.

## 12. Decisions

| Question | Decision |
|---|---|
| Where does the weather come from? | A shared, procedural cycle seeded by the clock: the same for everyone. |
| How does the allotment grow? | By the minutes you study. Crops are never sold for chips; they're eaten, traded or saved for seeds. |
| How do friends without a car appear in the car park? | They don't. You can buy a bike (shown in the bike rack) or a car. |
| How does a break end? | An earned break timer (1 min per 5 studied), then a bell and a choice of office or home. |
| Web hosting | EAS Hosting with a static export; Supabase for the backend. |
| Social model | Pairwise friendships, as in the MVP. See open questions. |

## 13. Open questions

1. **Eating:** what should eating a crop do? It's cosmetic for now.
2. **Neighbourly gardening:** can you water or harvest a friend's plot?
3. **Sign-ups:** invite-only (friend codes) or open?
4. **Friend groups:** keep pairwise friendships, or move to shared "offices"
   where everyone in the office sees everyone? This matters once friend
   circles overlap: today, two of your friends who aren't friends with each
   other can't see each other's chat.
5. **"Roughly" one chip a minute:** exactly 1 per minute, or small random
   bonuses?

## 14. Risks

- **App store review:** tobacco items affect age ratings on the App Store and
  Google Play, and Apple rejects apps that encourage tobacco use. Cigarettes
  are one row in `items`, so they can be renamed or swapped per platform.
- **Audio autoplay:** browsers stay silent until the first tap. The car park's
  first interaction unlocks sound.
- **Cheating:** rewards are computed in Postgres from server time, so a client
  can't award itself chips. Chat is friends-only and unstored, so there's
  nothing to moderate after the fact, but also no history.
- **Scale:** each open client polls every 10 s, which is fine for tens of
  players. Move to Realtime Postgres Changes if it grows.
