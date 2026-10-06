# 0003 · Usernames with accents, and unpinning a friend

**Where you are:** the real project has had migrations 0001 to 0007
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:** usernames can have accented letters (josé, zoë,
straße), and you can unpin a friend from the noticeboard. Nobody's existing
username or sign-in changes.

---

## 1. Run migration 0008, before the app that needs it goes out

The new app calls `remove_friend` and signs accented usernames in by their
plain spelling, so the database must have 0008 first. Run it just before
merging the pull request.

Check it hasn't been run already:

```sql
select to_regprocedure('public.remove_friend(text)') is not null as done;
```

If that says `false`, run `supabase/migrations/0008_accents_and_unfriending.sql`
once, as one transaction (Claude does this through the Supabase connector, in
an md5-guarded `do` block, as `CLAUDE.md` describes). It replaces the
username check on `profiles` and adds a unique index on the plain spelling,
which only succeeds if no two existing usernames share one. They can't yet,
since every username so far is plain.

Afterwards, the same query says `true`, and this lists every username with
its plain spelling (they should be the same, for now):

```sql
select username, private.username_key(username) from public.profiles order by 1;
```

## 2. Merge

Merging deploys the app (GitHub Actions). Then:

- [ ] Join with an invite using a username with an accent, log out, and sign
      in again with the accent left off.
- [ ] Unpin a friend on the noticeboard: it asks first, and they drop off
      both boards. Add them back.
