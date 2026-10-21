# 0006 · Streaks, and a new icon

**Where you are:** the real project has had migrations 0001 to 0015
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:**

- after a session, the payout says how many days in a row you've studied,
  once it's two or more. A day counts if you finished a session you didn't
  skip. Days go by London time, as days studied do on a friend's profile, and
  the streak holds until today is over;
- a new icon: two of the game's people and a timer.

Nobody's data changes. Streaks count sessions from before this too.

---

## 1. Run migration 0016, before the app that needs it goes out

The new app reads `streak` from `get_me`, so the database must have 0016
first. Run it just before merging the pull request.

Check it hasn't been run already:

```sql
select to_regprocedure('private.streak(uuid)') is not null as done;
```

If that says `false`, run `supabase/migrations/0016_streaks.sql` once, as one
transaction (Claude does this through the Supabase connector, in an
md5-guarded `do` block, as `CLAUDE.md` describes). It adds `private.streak`
and replaces `get_me`. Afterwards, the same query says `true`.

## 2. Merge

Merging deploys the app (GitHub Actions). Then:

- [ ] Study a short session to the end: if you studied yesterday too, the
      payout says how many days in a row.
- [ ] In a private window, the tab and a newly added home-screen icon show
      the two people and the timer. An icon already on a home screen may keep
      the old picture until it's removed and added again.
