-- Focus, part 14: friends of friends in the garden, and a little more on profiles.
--   * friends of your friends can see you walk about the garden (and you
--     them), but chat stays between friends: it moves to its own channel,
--     "garden-chat:<username>", which only you and your friends can hear.
--     Positions, hellos and rifts stay on "garden:<username>".
--   * profiles.active_at: when your app last checked in (at most once a
--     minute), for "last active" on a friend's profile
--   * get_profile also says how many friends they have, and how many you
--     have in common
-- Run after 0013_arranging_desks.sql.

alter table public.profiles add column active_at timestamptz;

-- A fair start: the last time anyone could tell you were about.
update public.profiles p
   set active_at = greatest(
     p.seen_at, p.arrived_at, p.went_home_at,
     (select max(s.started_at) from public.sessions s where s.user_id = p.id)
   );

-- ---------------------------------------------------------------------------
-- The garden's channels
-- ---------------------------------------------------------------------------

-- Whether you may listen on a garden topic: "garden:<username>" (where
-- someone is) for you, your friends and theirs; "garden-chat:<username>"
-- (what they say) for you and your friends only. The policies below ask it,
-- since they can't see friends' friendships themselves.
create or replace function public.may_listen(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where (p_topic = 'garden:' || p.username or p_topic = 'garden-chat:' || p.username)
      and (
        p.id = auth.uid()
        or exists (
          select 1 from public.friendships f
          where f.user_id = auth.uid() and f.friend_id = p.id
        )
        or (p_topic = 'garden:' || p.username
            and p.id = any (private.friends_of_friends(auth.uid())))
      )
  );
$$;

drop policy "garden chat: listen to yourself and friends" on realtime.messages;
drop policy "garden chat: speak only on your own channel" on realtime.messages;

create policy "garden: hear friends and their friends walk, chat with friends" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.may_listen((select realtime.topic()))
  );

create policy "garden: speak only on your own channels" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and (select realtime.topic()) in ('garden:' || p.username, 'garden-chat:' || p.username)
    )
  );

-- ---------------------------------------------------------------------------
-- You, and friends' profiles
-- ---------------------------------------------------------------------------

-- As in 0013, and notes that you're about.
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
  -- The app asks every few seconds while it's open; once a minute is plenty.
  update public.profiles set active_at = now()
   where id = v_uid and (active_at is null or active_at < now() - interval '1 minute');

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
    'desk_items',     private.desk_items_of(v_uid),
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

-- As in 0010, plus how many friends they have, how many you share, and when
-- they were last about.
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
      'friends',          (select count(*)::integer from public.friendships f where f.user_id = p.id),
      'in_common',        json_array_length(private.friends_in_common(v_uid, p.id)),
      'last_active',      p.active_at,
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
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function public.may_listen(text) from public, anon;
grant execute on function public.may_listen(text) to authenticated;
