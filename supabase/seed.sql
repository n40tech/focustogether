-- Local development only. `npx supabase start` (and `npx supabase db reset`)
-- runs this on the local Supabase on your computer, after the migrations
-- (see docs/TESTING.md). It makes three players who are all friends, and all
-- testers, so you can sign in straight away:
--
--   username alice, bob or carol; password focus-dev
--
-- and one spare invite, TESTJOIN (from alice), for trying the Join form.
-- It refuses to run on a database that already has players, so it can't
-- touch the real project.

do $$
declare
  v_player record;
  v_id     uuid;
  v_alice  uuid;
  v_email  text;
begin
  if exists (select 1 from public.profiles) then
    raise exception 'seed.sql is for a fresh local database, and this one already has players';
  end if;

  -- Players sign up as the app does: with an invite, through the
  -- invite-only trigger from 0003. alice's is from nobody; bob and carol use
  -- invites from alice, so they start out as her friends.
  for v_player in
    select * from (values (1, 'alice', 'Alice'), (2, 'bob', 'Bob'), (3, 'carol', 'Carol'))
      as p (n, username, display_name)
    order by n
  loop
    v_id := gen_random_uuid();
    v_email := v_player.username || '@focus.test';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt('focus-dev', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object(
        'invite', private.make_invite(v_alice),
        'username', v_player.username,
        'display_name', v_player.display_name
      ),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_id::text, v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
    if v_player.username = 'alice' then
      v_alice := v_id;
    end if;
  end loop;

  -- bob and carol are friends too.
  insert into public.friendships (user_id, friend_id)
  select a.id, b.id
  from public.profiles a
  join public.profiles b on a.id <> b.id
  where a.username in ('bob', 'carol') and b.username in ('bob', 'carol')
  on conflict do nothing;

  -- Everyone gets the Test button (with EXPO_PUBLIC_TESTING=true in .env).
  update public.profiles set tester = true;

  insert into public.invites (code, created_by, expires_at)
  values ('TESTJOIN', v_alice, now() + interval '1 year');
end
$$;
