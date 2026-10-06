# 0004 · Tidier invites, an invite tip, and adding to the home screen

**Where you are:** the real project has had migrations 0001 to 0008
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:**

- the noticeboard lists only invites still waiting to be used, so used and
  expired ones stop piling up;
- after a player's first studied session (not a skipped one), the car park
  and the garden suggest making an invite on the noticeboard;
- a new player on a phone's browser is shown how to add Focus Together to
  their home screen, with the steps for an iPhone or an Android phone.

Nobody's data changes. Sessions skipped before this can't be told apart from
studied ones, so they count as studied.

---

## 1. Run migration 0009, before the app that needs it goes out

The new app reads `sessions_studied` from `get_me`, so the database must have
0009 first. Run it just before merging the pull request.

Check it hasn't been run already:

```sql
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'sessions' and column_name = 'skipped'
) as done;
```

If that says `false`, run `supabase/migrations/0009_studied_sessions.sql`
once, as one transaction (Claude does this through the Supabase connector, in
an md5-guarded `do` block, as `CLAUDE.md` describes). It adds a column with a
default to `sessions` and replaces `skip_first_session` and `get_me`.

Afterwards, the same query says `true`, and nobody has a skipped session yet:

```sql
select count(*) from public.sessions where skipped;
```

## 2. Merge

Merging deploys the app (GitHub Actions). Then:

- [ ] Make an invite on the noticeboard and join with it in a private window:
      the invite drops off the first player's board, and the new player is
      pinned there instead.
- [ ] On an iPhone, join in Safari: the first tip in the car park gives
      Safari's steps for adding to the home screen. Add it, open it from the
      home screen, and sign in: the tip isn't there.
- [ ] On an Android phone, join in Chrome: the tip gives Chrome's steps, or an
      **Add** that installs it in a tap.
- [ ] Study a short session to the end: the car park and the garden suggest
      making an invite.
