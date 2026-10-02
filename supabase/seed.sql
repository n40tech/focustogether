-- Dummy accounts for the MVP. NOT NEEDED since 0003_community.sql: sign-up is
-- invite-only, and accounts made in the dashboard are refused. Make an invite
-- instead (select private.make_invite();) and join through the app; see
-- deployment/0001-setup-and-launch.md. Kept for databases without 0003.
--
-- 1. Supabase dashboard -> Authentication -> Users -> "Add user" -> "Create new user":
--      alice@focus.test   (tick "Auto Confirm User")
--      bob@focus.test     (tick "Auto Confirm User")
-- 2. Run this file in the SQL Editor (after the migrations) to create their profiles.
--
-- The app's login screen takes a username and signs in as <username>@focus.test.

insert into public.profiles (id, username, display_name)
select u.id, v.username, v.display_name
from (values
  ('alice@focus.test', 'alice', 'Alice'),
  ('bob@focus.test',   'bob',   'Bob')
) as v (email, username, display_name)
join auth.users u on u.email = v.email
on conflict (id) do nothing;

-- Make the two of them friends, so each sees the other in the car park,
-- office and garden.
insert into public.friendships (user_id, friend_id)
select a.id, b.id
from public.profiles a
join public.profiles b on a.id <> b.id
where a.username in ('alice', 'bob') and b.username in ('alice', 'bob')
on conflict do nothing;

-- Should list both users; if a row is missing, its auth user wasn't created yet.
select username, display_name, chips from public.profiles order by username;
