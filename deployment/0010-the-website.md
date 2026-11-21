# 0010 · The website, and invites from it

**Where you are:** the real project has had migrations 0001 to 0019
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:**

- a one-page website at <https://n40tech.github.io/focustogether/>, in
  `site/`. You start in the car park and find the office door (a Vegas arrow
  helps, and gets crosser the longer you don't). Then you pick a desk, hit the
  buzzer, and land in the garden, where a "join us" button dodges you twice
  before it gives you an invite;
- `website_invite()`, which makes that invite. Anyone can call it, signed in
  or not. Its invites are made by nobody, so whoever joins with one starts
  with no friends (the sign-up form says it's from Focus). Each is good for 2
  days, and the website gets at most 10 an hour and 30 a day between
  everyone. Past that, the website says to come back tomorrow, or to ask in
  the WhatsApp group.

Nobody's data changes. The game itself is unchanged.

---

## 1. Run migration 0020, before the website goes out

**Done on 2026-11-20**, together with 0019 and 0021: the schema matches a
local build at 0021.

The website calls `website_invite`, so the database must have 0020 before
the site is published. Run it just before merging.

Check it hasn't been run already:

```sql
select to_regprocedure('public.website_invite()') is not null as done;
```

If that says `false`, run `supabase/migrations/0020_website_invites.sql`
once, as one transaction (Claude does this through the Supabase connector, in
an md5-guarded `do` block, as `CLAUDE.md` describes). It adds a column with a
default to `invites` and adds `website_invite`.

Afterwards, the same query says `true`, and no invites are from the website
yet:

```sql
select count(*) from public.invites where from_website;
```

Then run the security advisor. It should say nothing new: `website_invite`
is meant to be callable by `anon`.

## 2. Turn on GitHub Pages (once)

In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. Pages needs the repo to be public on a free plan; the
workflow skips itself while it's private.

## 3. Merge

Merging publishes `site/` (`.github/workflows/pages.yml`). Then:

- [ ] Open the website. After 3 seconds the arrow lights up, and a few
      seconds later a subtitle says there's a hint. Move the mouse about: the
      arrow gets crosser, and the subtitles get ruder. Sit still for ten
      seconds: "Oh, you've given up", and it stops talking.
- [ ] Hover over the door: it glows and sparkles. Click it: the office drops
      in, with nobody at the free desks. A taken desk says you can't sit
      there; a free one sits you down.
- [ ] Press the buzzer and keep still: after the countdown you're in the
      garden, under "The Garden". Move the mouse during the countdown and it
      starts again; from the second time, five seconds longer.
- [ ] Catch "Join us" on the third try: a letter with an invite code flies
      out of the post box. **Join with it** opens the sign-up form with the
      code filled in, from Focus.
- [ ] Under the car park's title, a fortune cookie: tap it, and the slip
      slides out into the middle. In the office, a cookie only turns up
      during the countdown, hopping about. Opening it starts the count again,
      and it gets ruder each time ("You are a fool.", "You have been fooled
      twice.", "Idiot."), and then only shakes.
- [ ] On a phone, the same, with the buzzer under the desks. "Join us"
      leaps to the shed, then the post box, and the camera follows it.
- [ ] Shared in a chat, the link shows the car park with the title.

## When the game's art changes

The website's pictures are the game itself. Take them again with
`npm run site:shots` (it builds the web app and uses the browser tests'
pretend Supabase), check them, and commit `site/assets/scenes/`.
