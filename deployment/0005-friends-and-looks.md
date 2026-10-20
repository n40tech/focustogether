# 0005 · Friends, joining, desks, looks and notifications

**Where you are:** the real project has had migrations 0001 to 0009
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:** the noticeboard becomes the Friends board.
Adding a friend asks them first. A friend's profile shows what they've
studied and what they're worth. In the office, you can join a friend's
session so you finish together, and move to an empty desk. Friends of your
friends at work show see-through, so you can ask them to be friends.

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

## 3. Merge

Merging deploys the app (GitHub Actions). Then, with a friend:

- [ ] Ask someone to be friends on the Friends board. Their car park says
      someone has asked, and **Accept** puts you on each other's boards.
- [ ] Tap a friend's name on the board: their profile opens.
- [ ] While a friend studies, tap their desk in the office and **Join** them.
      Both countdowns match, and both sessions pay out together.
- [ ] Tap an empty desk and **Sit here**. Your car moves to the matching bay.
- [ ] With a friend of a friend at work, they show see-through at their
      desk; tapping them offers **Ask to be friends**.
