-- Focus, part 8: usernames with accents, and un-adding a friend.
--   * usernames can have accented letters (josé, zoë, straße). Supabase Auth
--     only takes plain emails, so an account's email is the username's plain
--     spelling: accents off, and a few letters spelt out (straße -> strasse).
--     Two usernames can't share a plain spelling, so "jose" and "josé" can't
--     both exist, and friends can find you by either. Every username so far
--     is already plain, so nobody's email changes.
--   * remove_friend ends a friendship (both ways, as add_friend makes it), and
--     calls off any offers between you, handing back what was offered
-- Run after 0007_post_and_first_day.sql: SQL Editor -> New query -> paste this file -> Run.

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------

-- How a typed username is stored: trimmed, lower case, accents composed (so
-- "e" followed by a combining accent is the same as "é").
create or replace function private.normal_username(p_username text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select normalize(lower(trim(p_username)), nfc);
$$;

-- A username's plain spelling: no accents, and ß, æ, ø and friends spelt
-- with a-z. It's unique, it's what the account's email is made of, and
-- friends can type it instead. src/lib/username.ts does the same in the app.
create or replace function private.username_key(p_username text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(replace(replace(replace(
    translate(
      regexp_replace(normalize(lower(trim(p_username)), nfd), '[̀-ͯ]', '', 'g'),
      U&'\00f8\00f0\0142\0111\0127\0131\0167\014b\0140',
      'odldhitnl'
    ),
    U&'\00df', 'ss'), U&'\00e6', 'ae'), U&'\0153', 'oe'), U&'\00fe', 'th');
$$;

-- 3 to 20 letters (with or without an accent), numbers or _, stored as
-- normal_username leaves them. Accents must be part of their letter: no
-- stacks of loose ones.
create or replace function private.is_username(p_username text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select char_length(p_username) between 3 and 20
     and p_username = private.normal_username(p_username)
     and p_username !~ '[̀-ͯ]'
     and private.username_key(p_username) ~ '^[a-z0-9_]+$';
$$;

alter table public.profiles drop constraint profiles_username_check;
alter table public.profiles
  add constraint profiles_username_check check (private.is_username(username));

create unique index profiles_plain_username on public.profiles (private.username_key(username));

-- As in 0003, but the username may have accents, and the email is its plain
-- spelling.
create or replace function private.on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite', ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := private.normal_username(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_name     text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_invite   public.invites;
begin
  select * into v_invite from public.invites where code = v_code for update;
  if not found or v_invite.used_by is not null or v_invite.expires_at < now() then
    raise exception 'Focus is invite-only, and that invite code isn''t valid';
  end if;
  if not private.is_username(v_username) then
    raise exception 'Usernames are 3 to 20 letters, numbers or _';
  end if;
  if new.email is distinct from private.username_key(v_username) || '@focus.test' then
    raise exception 'The account email must be <plain username>@focus.test';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, coalesce(v_name, v_username));

  update public.invites set used_by = new.id, used_at = now() where code = v_code;

  if v_invite.created_by is not null then
    insert into public.friendships (user_id, friend_id)
    values (new.id, v_invite.created_by), (v_invite.created_by, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.check_signup(p_code text, p_username text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := private.normal_username(coalesce(p_username, ''));
  v_from     text;
  v_taken    text;
begin
  select coalesce(p.display_name, 'Focus') into v_from
  from public.invites i
  left join public.profiles p on p.id = i.created_by
  where i.code = v_code and i.used_by is null and i.expires_at > now();

  if v_from is null then
    return json_build_object('ok', false, 'reason', 'That invite code isn''t valid, or it''s been used');
  end if;
  if not private.is_username(v_username) then
    return json_build_object('ok', false, 'from', v_from,
      'reason', 'Usernames are 3 to 20 letters, numbers or _. Accents are fine');
  end if;
  select username into v_taken
  from public.profiles
  where private.username_key(username) = private.username_key(v_username);
  if v_taken = v_username then
    return json_build_object('ok', false, 'from', v_from, 'reason', 'That username is taken');
  end if;
  if v_taken is not null then
    return json_build_object('ok', false, 'from', v_from,
      'reason', format('That''s too close to @%s, who''s already here', v_taken));
  end if;
  return json_build_object('ok', true, 'from', v_from);
end;
$$;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------

-- As in 0001, but by either spelling of their username.
create or replace function public.add_friend(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_friend public.profiles;
begin
  select * into v_friend
  from public.profiles
  where private.username_key(username) = private.username_key(p_username);

  if not found then
    raise exception 'No user called "%"', trim(p_username);
  end if;
  if v_friend.id = v_uid then
    raise exception 'You can''t add yourself';
  end if;
  if exists (
    select 1 from public.friendships
    where user_id = v_uid and friend_id = v_friend.id
  ) then
    raise exception 'You''re already friends with %', v_friend.username;
  end if;

  insert into public.friendships (user_id, friend_id)
  values (v_uid, v_friend.id), (v_friend.id, v_uid)
  on conflict do nothing;

  return json_build_object('username', v_friend.username);
end;
$$;

-- Ends a friendship, both ways. Offers between you are called off and what
-- was offered goes back; letters already sent stay where they are.
create or replace function public.remove_friend(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_friend public.profiles;
  v_trade  public.trades;
begin
  select p.* into v_friend
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);

  if not found then
    raise exception 'You''re not friends with %', private.normal_username(p_username);
  end if;

  for v_trade in
    select * from public.trades
    where status = 'open'
      and ((from_user = v_uid and to_user = v_friend.id)
        or (from_user = v_friend.id and to_user = v_uid))
    for update
  loop
    perform private.add_item(v_trade.from_user, v_trade.give_item, v_trade.give_qty);
    update public.trades set status = 'cancelled', closed_at = now() where id = v_trade.id;
  end loop;

  delete from public.friendships
  where (user_id = v_uid and friend_id = v_friend.id)
     or (user_id = v_friend.id and friend_id = v_uid);

  return json_build_object('username', v_friend.username);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function public.remove_friend(text) from public, anon;
grant execute on function public.remove_friend(text) to authenticated;
