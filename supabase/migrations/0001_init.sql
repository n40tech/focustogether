-- Focus app MVP schema.
-- Run this whole file in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Clients never write tables directly: RLS allows reads only, and every change
-- goes through the security-definer functions at the bottom, which use auth.uid().
-- Status (focused / on_break / absent) is derived at read time, never stored.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  points       integer not null default 0,
  -- Set when the user taps "Leave" during a break; a completed session that
  -- ends after this timestamp puts them back on break.
  left_at      timestamptz
);

create table public.sessions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  started_at   timestamptz not null default now(),
  duration_min integer not null check (duration_min between 1 and 120),
  status       text not null default 'active'
               check (status in ('active', 'completed', 'cancelled')),
  ended_at     timestamptz
);

-- At most one running session per user.
create unique index sessions_one_active on public.sessions (user_id) where status = 'active';
create index sessions_completed_by_user on public.sessions (user_id, ended_at desc) where status = 'completed';

-- Mutual friendships are stored as two rows (a->b and b->a).
create table public.friendships (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- ---------------------------------------------------------------------------
-- Row level security: read-only access to your own data and your friends'.
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.sessions    enable row level security;
alter table public.friendships enable row level security;

create policy "read own and friends' profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.user_id = (select auth.uid()) and f.friend_id = profiles.id
    )
  );

create policy "read own sessions" on public.sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read own friendships" on public.friendships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Internal helpers (not exposed over the API)
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Lazily completes any expired active sessions for the given users and awards
-- 1 point per minute. Concurrent callers are safe: the row lock plus the
-- status = 'active' re-check means a session is only ever completed once.
create or replace function private.finalize_expired(p_user_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.sessions s
       set status   = 'completed',
           ended_at = s.started_at + make_interval(mins => s.duration_min)
     where s.user_id = any (p_user_ids)
       and s.status = 'active'
       and s.started_at + make_interval(mins => s.duration_min) <= now()
    returning s.user_id, s.duration_min
  ),
  totals as (
    select user_id, sum(duration_min)::integer as pts from done group by user_id
  )
  update public.profiles p
     set points = p.points + t.pts
    from totals t
   where p.id = t.user_id;
$$;

-- Call finalize_expired first so expired sessions don't read as "absent".
create or replace function private.status_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.sessions s
      where s.user_id = p_user_id
        and s.status = 'active'
        and s.started_at + make_interval(mins => s.duration_min) > now()
    ) then 'focused'
    when exists (
      select 1
      from public.sessions s
      join public.profiles p on p.id = s.user_id
      where s.user_id = p_user_id
        and s.status = 'completed'
        and s.ended_at > now() - interval '80 minutes'
        and (p.left_at is null or p.left_at < s.ended_at)
    ) then 'on_break'
    else 'absent'
  end;
$$;

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API (called with supabase.rpc)
-- ---------------------------------------------------------------------------

create or replace function public.get_me()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_result json;
begin
  perform private.finalize_expired(array[v_uid]);

  select json_build_object(
    'id',           p.id,
    'username',     p.username,
    'display_name', p.display_name,
    'points',       p.points,
    'status',       private.status_of(p.id),
    'active_session', (
      select json_build_object(
        'started_at',   s.started_at,
        'duration_min', s.duration_min,
        'ends_at',      s.started_at + make_interval(mins => s.duration_min)
      )
      from public.sessions s
      where s.user_id = v_uid and s.status = 'active'
    ),
    'last_completed', (
      select json_build_object('ended_at', s.ended_at, 'duration_min', s.duration_min)
      from public.sessions s
      where s.user_id = v_uid and s.status = 'completed'
      order by s.ended_at desc
      limit 1
    ),
    -- Lets the client correct for its own clock being off.
    'server_now', now()
  )
  into v_result
  from public.profiles p
  where p.id = v_uid;

  if v_result is null then
    raise exception 'No profile for this account. Run supabase/seed.sql.';
  end if;
  return v_result;
end;
$$;

create or replace function public.get_friends_board()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_friends uuid[];
begin
  select coalesce(array_agg(friend_id), '{}') into v_friends
  from public.friendships where user_id = v_uid;

  perform private.finalize_expired(v_friends);

  return (
    select coalesce(json_agg(row_to_json(b) order by b.display_name), '[]'::json)
    from (
      select
        p.username,
        p.display_name,
        p.points,
        private.status_of(p.id) as status,
        (
          select s.started_at + make_interval(mins => s.duration_min)
          from public.sessions s
          where s.user_id = p.id and s.status = 'active'
        ) as ends_at
      from public.profiles p
      where p.id = any (v_friends)
    ) b
  );
end;
$$;

create or replace function public.add_friend(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_uid();
  v_friend_id uuid;
begin
  select id into v_friend_id
  from public.profiles
  where username = lower(trim(p_username));

  if v_friend_id is null then
    raise exception 'No user called "%"', trim(p_username);
  end if;
  if v_friend_id = v_uid then
    raise exception 'You can''t add yourself';
  end if;
  if exists (
    select 1 from public.friendships
    where user_id = v_uid and friend_id = v_friend_id
  ) then
    raise exception 'You''re already friends with %', lower(trim(p_username));
  end if;

  insert into public.friendships (user_id, friend_id)
  values (v_uid, v_friend_id), (v_friend_id, v_uid)
  on conflict do nothing;

  return json_build_object('username', lower(trim(p_username)));
end;
$$;

create or replace function public.start_session(p_minutes integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then
    raise exception 'Sessions must be between 1 and 120 minutes';
  end if;

  perform private.finalize_expired(array[v_uid]);

  if exists (select 1 from public.sessions where user_id = v_uid and status = 'active') then
    raise exception 'A session is already running';
  end if;

  insert into public.sessions (user_id, duration_min) values (v_uid, p_minutes);
  update public.profiles set left_at = null where id = v_uid;

  return public.get_me();
end;
$$;

-- Cancelling awards no points.
create or replace function public.cancel_session()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  -- If the timer already ran out, the session counts as completed and can't be cancelled.
  perform private.finalize_expired(array[v_uid]);

  update public.sessions
     set status = 'cancelled', ended_at = now()
   where user_id = v_uid and status = 'active';

  if not found then
    raise exception 'No session is running';
  end if;

  return public.get_me();
end;
$$;

create or replace function public.leave()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);

  if private.status_of(v_uid) <> 'on_break' then
    raise exception 'You can only leave while on a break';
  end if;

  update public.profiles set left_at = now() where id = v_uid;

  return public.get_me();
end;
$$;

-- Only signed-in users may call the API.
revoke execute on function
  public.get_me(),
  public.get_friends_board(),
  public.add_friend(text),
  public.start_session(integer),
  public.cancel_session(),
  public.leave()
from public, anon;

grant execute on function
  public.get_me(),
  public.get_friends_board(),
  public.add_friend(text),
  public.start_session(integer),
  public.cancel_session(),
  public.leave()
to authenticated;
