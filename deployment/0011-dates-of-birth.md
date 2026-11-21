# 0011 · Dates of birth, and no cigarettes for under-18s

**Where you are:** the real project has had migrations 0001 to 0020
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:**

- the Join form asks for a date of birth, typed day first (14/03/2009). It's
  kept in `public.birthdays`, which nobody can read through the API, not
  even its owner. The app only hears `under_18` from `get_me`;
- under-18s have no cigarettes. The shed doesn't show them, there's no Smoke
  button, a friend's trade or stall can't pass them any (`private.add_item`
  refuses), and they don't see friends smoking. On their 18th birthday that
  stops by itself.

Players who joined before have no date of birth, and count as grown-ups.
Nobody's data changes.

---

## 1. Run migration 0021, just before merging

**Done on 2026-11-20**, after 0019 and 0020: the schema matches a local
build at 0021, nobody has a date of birth, and nobody counts as under 18.

Once 0021 is in, signing up needs a date of birth, and the app that's live
until the merge doesn't send one. So run it just before merging, and merge
straight after: sign-ups in between fail with "Database error saving new
user".

Check it hasn't been run already:

```sql
select to_regclass('public.birthdays') is not null as done;
```

If that says `false`, run `supabase/migrations/0021_dates_of_birth.sql` once,
as one transaction (Claude does this through the Supabase connector, in an
md5-guarded `do` block, as `CLAUDE.md` describes). It adds the `birthdays`
table and `private.under_18`, and replaces `add_item`, `on_signup`, `get_me`,
`get_shop` and `smoke`.

Afterwards, the same query says `true`, and nobody has a date of birth yet:

```sql
select count(*) from public.birthdays;
```

Then run the security advisor. It will note that `birthdays` has row-level
security on and no policies: that's on purpose.

## 2. Merge, then check

- [ ] Join with an invite and a date of birth over 18 years ago: the shed
      sells cigarettes, and you can smoke on a break.
- [ ] Join with another invite and a date of birth under 18 years ago: no
      cigarettes in the shed, and no Smoke button in the car park or the
      garden.
- [ ] A date that isn't real (31/02/2009) is turned down on the form.
