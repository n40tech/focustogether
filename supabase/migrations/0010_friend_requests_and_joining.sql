-- Focus, part 10: asking to be friends, friends' profiles, and studying together.
--   * add_friend now asks. You become friends once they say yes, or ask you
--     back. Invites still make you friends at once. A request can be
--     withdrawn, and saying no doesn't tell the asker.
--   * get_profile: how long you've been friends, a friend's minutes, sessions
--     and days studied, and what they're worth (chips plus the shop price of
--     what they own)
--   * join_session: start a session that ends when a friend's does
-- Run after 0009_studied_sessions.sql.

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------

create table public.friend_requests (
  from_id    uuid not null references public.profiles (id) on delete cascade,
  to_id      uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

create index friend_requests_to on public.friend_requests (to_id, created_at);

alter table public.friend_requests enable row level security;

create policy "read requests to or from you" on public.friend_requests
  for select to authenticated
  using ((select auth.uid()) in (from_id, to_id));

-- Makes two players friends, both ways, and clears any requests between them.
create or replace function private.befriend(p_a uuid, p_b uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.friendships (user_id, friend_id)
  values (p_a, p_b), (p_b, p_a)
  on conflict do nothing;
  delete from public.friend_requests
  where (from_id = p_a and to_id = p_b) or (from_id = p_b and to_id = p_a);
$$;

-- The display names of p_user's friends who are also friends with p_other.
create or replace function private.friends_in_common(p_user uuid, p_other uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(p.display_name order by p.display_name), '[]'::json)
  from public.friendships mine
  join public.friendships theirs
    on theirs.user_id = mine.friend_id and theirs.friend_id = p_other
  join public.profiles p on p.id = mine.friend_id
  where mine.user_id = p_user;
$$;

-- As in 0008, but it asks. If they'd already asked you, you're friends now.
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

  if exists (
    select 1 from public.friend_requests
    where from_id = v_friend.id and to_id = v_uid
  ) then
    perform private.befriend(v_uid, v_friend.id);
    return json_build_object('username', v_friend.username, 'friends', true);
  end if;
  if exists (
    select 1 from public.friend_requests
    where from_id = v_uid and to_id = v_friend.id
  ) then
    raise exception 'You''ve already asked %', v_friend.username;
  end if;

  insert into public.friend_requests (from_id, to_id) values (v_uid, v_friend.id);
  return json_build_object('username', v_friend.username, 'friends', false);
end;
$$;

-- Requests to you, oldest first, with the friends you have in common; and the
-- ones you've made that are still waiting.
create or replace function public.get_friend_requests()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return json_build_object(
    'to_you', (
      select coalesce(json_agg(json_build_object(
        'username',     p.username,
        'display_name', p.display_name,
        'via',          private.friends_in_common(v_uid, p.id)
      ) order by r.created_at), '[]'::json)
      from public.friend_requests r
      join public.profiles p on p.id = r.from_id
      where r.to_id = v_uid
    ),
    'from_you', (
      select coalesce(json_agg(json_build_object(
        'username',     p.username,
        'display_name', p.display_name
      ) order by r.created_at), '[]'::json)
      from public.friend_requests r
      join public.profiles p on p.id = r.to_id
      where r.from_id = v_uid
    )
  );
end;
$$;

-- Says yes (you're friends, both ways) or no (the request goes; they aren't told).
create or replace function public.answer_friend_request(p_username text, p_accept boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_from uuid;
begin
  select r.from_id into v_from
  from public.friend_requests r
  join public.profiles p on p.id = r.from_id
  where r.to_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);

  if not found then
    raise exception 'No request from %', private.normal_username(p_username);
  end if;

  if p_accept then
    perform private.befriend(v_uid, v_from);
  else
    delete from public.friend_requests where from_id = v_from and to_id = v_uid;
  end if;
  return public.get_friend_requests();
end;
$$;

create or replace function public.withdraw_friend_request(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.friend_requests r
  using public.profiles p
  where p.id = r.to_id
    and r.from_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);

  if not found then
    raise exception 'You haven''t asked %', private.normal_username(p_username);
  end if;
  return public.get_friend_requests();
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- A friend's profile: where they are, how long you've been friends, what
-- they've studied (skipped sessions don't count; days are UK dates), and
-- their chips plus the shop price of what they own. Produce has no price.
create or replace function public.get_profile(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_friend uuid;
  v_since  timestamptz;
begin
  select f.friend_id, f.created_at into v_friend, v_since
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);

  if not found then
    raise exception 'You''re not friends with %', private.normal_username(p_username);
  end if;

  perform private.finalize_expired(array[v_friend]);

  return (
    select json_build_object(
      'username',         p.username,
      'display_name',     p.display_name,
      'status',           pr.status,
      'ends_at',          pr.ends_at,
      'break_ends_at',    pr.break_ends_at,
      'friends_since',    v_since,
      'minutes_studied',  st.minutes,
      'sessions_studied', st.sessions,
      'days_studied',     st.days,
      'net_worth',        p.chips + (
        select coalesce(round(sum(i.qty::numeric * it.price / it.pack_size)), 0)::integer
        from public.inventory i
        join public.items it on it.slug = i.item
        where i.user_id = p.id and it.price is not null
      ),
      'server_now',       now()
    )
    from public.profiles p
    cross join lateral private.presence(p.id) pr
    cross join lateral (
      select coalesce(sum(s.duration_min), 0)::integer as minutes,
             count(*)::integer as sessions,
             count(distinct (s.started_at at time zone 'Europe/London')::date)::integer as days
      from public.sessions s
      where s.user_id = p.id and s.status = 'completed' and not s.skipped
    ) st
    where p.id = v_friend
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Studying together
-- ---------------------------------------------------------------------------

-- Starts a session that ends when a friend's does: their time left, rounded
-- up to a whole minute, started up to 59 seconds ago. Otherwise it's
-- start_session: you arrive, sit at your desk, and leave this page at your peril.
create or replace function public.join_session(p_username text, p_device text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_friend  public.profiles;
  v_status  text;
  v_ends_at timestamptz;
  v_minutes integer;
begin
  select p.* into v_friend
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);

  if not found then
    raise exception 'You can only join friends';
  end if;

  perform private.finalize_expired(array[v_uid, v_friend.id]);

  if exists (select 1 from public.sessions where user_id = v_uid and status = 'active') then
    raise exception 'A session is already running';
  end if;

  select pr.status, pr.ends_at into v_status, v_ends_at from private.presence(v_friend.id) pr;
  if v_status <> 'focused' then
    raise exception '% isn''t studying', v_friend.display_name;
  end if;
  if v_ends_at - now() < interval '1 minute' then
    raise exception '% is nearly done', v_friend.display_name;
  end if;
  v_minutes := ceil(extract(epoch from v_ends_at - now()) / 60)::integer;

  perform private.arrive(v_uid);
  insert into public.sessions (user_id, started_at, duration_min, device)
  values (v_uid, v_ends_at - make_interval(mins => v_minutes), v_minutes, left(p_device, 64));
  update public.profiles
     set activity = null, activity_until = null, place = 'office', seen_at = now()
   where id = v_uid;

  return public.get_me();
end;
$$;

-- ---------------------------------------------------------------------------
-- You
-- ---------------------------------------------------------------------------

-- As in 0009, plus friend_requests: how many players are waiting for your answer.
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

  -- Only while you're still at work: opening the app the next day doesn't
  -- put you back at yesterday's desk.
  if private.status_of(v_uid) <> 'absent' then
    update public.profiles set seen_at = now() where id = v_uid;
  end if;

  select json_build_object(
    'id',             p.id,
    'username',       p.username,
    'display_name',   p.display_name,
    'chips',          p.chips,
    'status',         pr.status,
    'break_ends_at',  pr.break_ends_at,
    'desk',           case when pr.status <> 'absent' then p.desk end,
    'place',          case
                        when pr.status = 'focused' then 'office'
                        when pr.status <> 'absent' then p.place
                      end,
    'vehicle',        p.vehicle,
    'activity',       case when p.activity_until > now() then p.activity end,
    'activity_until', case when p.activity_until > now() then p.activity_until end,
    'active_session', (
      select json_build_object(
        'id',           s.id,
        'started_at',   s.started_at,
        'duration_min', s.duration_min,
        'ends_at',      s.started_at + make_interval(mins => s.duration_min),
        'device',       s.device
      )
      from public.sessions s
      where s.user_id = v_uid and s.status = 'active'
    ),
    'last_completed', (
      select json_build_object(
        'id',           s.id,
        'ended_at',     s.ended_at,
        'duration_min', s.duration_min,
        'chips',        coalesce(s.chips, s.duration_min),
        'break_min',    private.break_minutes(s.duration_min)
      )
      from public.sessions s
      where s.user_id = v_uid and s.status = 'completed'
      order by s.ended_at desc
      limit 1
    ),
    'left_session', (
      select case when s.status = 'cancelled' and s.left_at > now() - interval '12 hours' then
        json_build_object(
          'id',           s.id,
          'started_at',   s.started_at,
          'left_at',      s.left_at,
          'duration_min', s.duration_min
        )
      end
      from public.sessions s
      where s.user_id = v_uid
      order by s.started_at desc
      limit 1
    ),
    'sessions_done',  (
      select count(*)::integer from public.sessions s
      where s.user_id = v_uid and s.status = 'completed'
    ),
    'sessions_studied', (
      select count(*)::integer from public.sessions s
      where s.user_id = v_uid and s.status = 'completed' and not s.skipped
    ),
    'ripe', (
      select coalesce(json_agg(json_build_object(
        'bed',        b.bed,
        'crop',       b.crop,
        'withers_at', b.withers_at
      ) order by b.ripe_at, b.bed, b.spot), '[]'::json)
      from private.beds b
      where b.user_id = v_uid and b.ripe
    ),
    'letters',        (
      select count(*)::integer from public.letters l
      where l.to_user = v_uid and l.read_at is null
    ),
    'friend_requests', (
      select count(*)::integer from public.friend_requests r where r.to_id = v_uid
    ),
    'tips',           to_json(p.tips),
    'inventory',      private.inventory_of(v_uid),
    'tester',         p.tester,
    'server_now',     now()
  )
  into v_result
  from public.profiles p
  cross join lateral private.presence(p.id) pr
  where p.id = v_uid;

  if v_result is null then
    raise exception 'No profile for this account';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.get_friend_requests(),
  public.answer_friend_request(text, boolean),
  public.withdraw_friend_request(text),
  public.get_profile(text),
  public.join_session(text, text)
from public, anon;

grant execute on function
  public.get_friend_requests(),
  public.answer_friend_request(text, boolean),
  public.withdraw_friend_request(text),
  public.get_profile(text),
  public.join_session(text, text)
to authenticated;
