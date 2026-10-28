# 0007 · Hard mode, emails, driving, and study invites

**Where you are:** the real project has had migrations 0001 to 0016
(`deployment/0001-setup-and-launch.md`, step 2, checks which). If 0016 hasn't
been run yet, do `deployment/0006-streaks-and-icon.md` first.

**What this update brings:**

- **Leaving the page no longer stops a session.** It runs whatever you do,
  and pays when it ends. **Hard mode**, a switch in the office before you
  start, brings back the strict rules: leave the page (on a phone) or close
  the tab (on a computer) for more than 10 seconds and the session stops,
  with no chips. The switch is remembered for each account, and each session
  keeps the mode it started in.
- **Sign-up asks for a real email**, for news of Focus Together. Only its
  owner can see it. Players who joined before are asked once, in the car
  park, to add theirs on the Friends board.
- **The car park is a place to be.** You drive in from the road and park
  wherever there's room, then get out and walk about, smoke, and chat with
  friends who are out there too. Driving into a friend's parked car or bike
  damages both (health 0 to 100, which shows on the vehicle; tap one to see
  it). They can claim damages from you, which you pay unless you're insured.
  The shed repairs vehicles (half the price for a wreck) and sells
  insurance: 30 chips a week, suggested when you buy a vehicle.
- **Study invites.** While you study, *Invite someone to study with you*
  copies a link. Whoever opens it (signing up first if they need to) becomes
  your friend and joins your session, which ends when yours does. Any invite
  link opened by someone already signed in now makes you friends too.

Nobody's data changes. Players keep their vehicles, as good as new.

---

## 1. Run migration 0017, before the app that needs it goes out

The new app calls `park`, `crash`, `use_invite` and more, and reads
`hard_mode` from `get_me`, so the database must have 0017 first. Run it just
before merging the pull request.

Check it hasn't been run already:

```sql
select to_regclass('public.crashes') is not null as done;
```

If that says `false`, run `supabase/migrations/0017_hard_mode_driving_and_study_invites.sql`
once, as one transaction (Claude does this through the Supabase connector,
in an md5-guarded `do` block, as `CLAUDE.md` describes). Afterwards, the same
query says `true`, and the security advisor shows only the warnings
`deployment/0001-setup-and-launch.md` expects, plus `check_signup` (which
now takes an email) still callable without signing in.

## 2. Merge

Merging deploys the app (GitHub Actions). Then:

- [ ] Start a short session on your phone, switch to another app for a
      minute, and come back: it's still running.
- [ ] Turn on hard mode in the office and do the same: it stops.
- [ ] In a private window, open a new invite link: the Join form asks for an
      email, and refuses `you@focus.test`.
- [ ] With a vehicle, open the car park after going home: you're on the road
      in it. Drive in, get out, and walk about.
- [ ] Mid-session, *Invite someone to study with you*, and open the link
      signed in as a second player: they land in the office, studying with
      you.

## Reading the emails

They're in the `emails` table (Table Editor, or SQL):

```sql
select p.username, e.email, e.added_at
from public.emails e join public.profiles p on p.id = e.user_id
order by e.added_at;
```

People gave them for news of Focus Together, so use them only for that, and
take anyone off the list who asks.
