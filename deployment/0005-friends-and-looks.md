# 0005 · Friends, joining, desks, looks and notifications

**Where you are:** the real project has had migrations 0001 to 0009
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:** the noticeboard becomes the Friends board.
Adding a friend asks them first. A friend's profile shows what they've
studied and what they're worth. In the office, you can join a friend's
session so you finish together, and move to an empty desk. Friends of your
friends at work show see-through, so you can ask them to be friends. In
the garden, everyone can choose how they look, and in the office everyone
can arrange their desk. Friends of friends walk about the garden too, and
profiles say when someone was last active.

---

## 1. Run migration 0010, before the app that needs it goes out

The new app calls `get_friend_requests`, `get_profile` and `join_session`,
and expects `add_friend` to ask rather than add. So the database must have
0010 first. Run it just before merging the pull request.

Check it hasn't been run already:

```sql
select to_regprocedure('public.join_session(text,text)') is not null as done;
```

If that says `false`, run `supabase/migrations/0010_friend_requests_and_joining.sql`
once, as one transaction (Claude does this through the Supabase connector, in
an md5-guarded `do` block, as `CLAUDE.md` describes). It adds the
`friend_requests` table and replaces `add_friend` and `get_me`. Nobody's
friends or sessions change.

Afterwards, the same query says `true`, and this says 0 (nobody has asked yet):

```sql
select count(*) from public.friend_requests;
```

An app page left open from before keeps working: its **Add** button now asks
instead of adding.

## 2. Run migration 0011

The new app calls `get_friends_of_friends` and `switch_desk`. Check:

```sql
select to_regprocedure('public.switch_desk(integer)') is not null as done;
```

If `false`, run `supabase/migrations/0011_desks_and_friends_of_friends.sql`
the same way. It replaces `private.arrive` (desks now avoid friends of
friends) and adds the two functions. Nobody's desk changes until they next
arrive. Afterwards the query says `true`.

## 3. Run migration 0012

The new app calls `get_looks` and `set_looks`. Check:

```sql
select to_regprocedure('public.set_looks(jsonb)') is not null as done;
```

If `false`, run `supabase/migrations/0012_looks.sql` the same way. It adds
`profiles.looks` (empty for everyone, so nobody's look changes until they
choose) and the two functions. Afterwards the query says `true`.

## 4. Run migration 0013

The new app calls `place_desk_item` and `store_desk_item`, and expects desk
things with positions. Check:

```sql
select to_regclass('public.desk_layout') is not null as done;
```

If `false`, run `supabase/migrations/0013_arranging_desks.sql` the same way.
It puts everyone's desk things where they're drawn today (rehearsed on a
database with a full desk), then replaces `get_me`, `get_friends_board` and
`get_friends_of_friends`. Afterwards the query says `true`, and every desk
thing anyone owns has a place:

```sql
select count(*) from public.inventory i join public.items it on it.slug = i.item
where it.kind = 'desk' and not exists (
  select 1 from public.desk_layout l where l.user_id = i.user_id and l.item = i.item);
```

That should say 0.

## 5. Run migration 0014

The new app speaks in the garden on `garden-chat:<username>` and listens to
friends of friends' `garden:` channels, which needs 0014's realtime policies.
It also reads `last_active`, `friends` and `in_common` from `get_profile`.
Check:

```sql
select to_regprocedure('public.may_listen(text)') is not null as done;
```

If `false`, run `supabase/migrations/0014_circles_and_last_active.sql` the
same way. It adds `profiles.active_at` (filled in from what's known), swaps
the two garden policies on `realtime.messages` for new ones, and replaces
`get_me` and `get_profile`. Afterwards the query says `true`, and this lists
the two new policies:

```sql
select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';
```

Chat between a page still on the old app and one on the new one doesn't get
through until both have reloaded, as they now use different channels.

## 6. Merge

Merging deploys the app (GitHub Actions). Then, with a friend:

- [ ] Ask someone to be friends on the Friends board. Their car park says
      someone has asked, and **Accept** puts you on each other's boards.
- [ ] Tap a friend's name on the board: their profile opens.
- [ ] While a friend studies, tap their desk in the office and **Join** them.
      Both countdowns match, and both sessions pay out together.
- [ ] Tap an empty desk and **Sit here**. Your car moves to the matching bay.
- [ ] With a friend of a friend at work, they show see-through at their
      desk; tapping them offers **Ask to be friends**.
- [ ] In the garden, **Your look**: save a new look, and a friend sees it.
- [ ] **Arrange your desk**: drag something to a new place, and a friend
      sees it there.
- [ ] Chat in the garden with a friend: you see each other's words.
- [ ] A friend's profile on the Friends board says when they were last
      active.
