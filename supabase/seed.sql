-- Dummy accounts for the MVP.
--
-- 1. Supabase dashboard -> Authentication -> Users -> "Add user" -> "Create new user":
--      alice@focus.test   (tick "Auto Confirm User")
--      bob@focus.test     (tick "Auto Confirm User")
-- 2. Run this file in the SQL Editor to create their profiles.
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

-- Should list both users; if a row is missing, its auth user wasn't created yet.
select username, display_name, points from public.profiles order by username;
