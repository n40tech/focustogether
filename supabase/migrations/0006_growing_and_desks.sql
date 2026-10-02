-- Focus, part 6: crops grow in real time; people stay at their desks.
--   * crops ripen over a few days of real time, depending on the crop (radish
--     a day, pumpkin five), studying or not. A watered bed grows half as fast
--     again for a day. Ripe crops still keep for 2 days, then wither.
--   * where you are at work (office, garden or outside) is kept, so friends
--     see you at your desk after a session until you get up and leave it, and
--     while your app is open in the office or the garden you count as at work.
--   * the testing tools (0005) skip and ripen crops the new way.
-- Run after 0005_testing.sql: SQL Editor -> New query -> paste this file -> Run.

-- ---------------------------------------------------------------------------
-- Real-time growth
-- ---------------------------------------------------------------------------

-- Hours a crop takes to ripen in a bed nobody waters.
alter table public.crops add column grow_hours integer check (grow_hours > 0);
update public.crops
   set grow_hours = case produce
                      when 'radish'     then 24
                      when 'carrot'     then 36
                      when 'strawberry' then 48
                      when 'tomato'     then 72
                      when 'sunflower'  then 96
                      when 'pumpkin'    then 120
                      else 72
                    end;
alter table public.crops alter column grow_hours set not null;

-- A bed's growth, kept lazily: grown_s seconds of growing as of settled_at.
-- From then on it grows by the clock, faster while the last watering lasts.
-- (watered_at is never after settled_at: watering settles the bed first.)
alter table public.plots
  add column grown_s    double precision not null default 0,
  add column settled_at timestamptz not null default now();

-- Plants already in the ground keep their share of growing, now in hours;
-- ripe ones keep the moment they ripened, so their two days don't restart.
update public.plots b
   set grown_s    = c.grow_hours * 3600.0 * least(1, b.growth_min::double precision / c.grow_min),
       settled_at = coalesce(b.ripe_at, now())
  from public.crops c
 where c.produce = b.crop;

alter table public.plots drop column growth_min, drop column ripe_at;
alter table public.crops drop column grow_min;

-- How long a watering lasts, and how much faster a bed grows meanwhile.
create or replace function private.moist_for()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 day';
$$;

create or replace function private.watered_speed()
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 1.5::double precision;
$$;

-- Seconds of growing a bed has done by p_at.
create or replace function private.growth_at(
  p_grown   double precision,
  p_settled timestamptz,
  p_watered timestamptz,
  p_at      timestamptz
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select p_grown
    + private.watered_speed()
      * greatest(0, extract(epoch from least(p_at, m.until) - p_settled)::double precision)
    + greatest(0, extract(epoch from p_at - greatest(p_settled, m.until))::double precision)
  from (
    -- Never watered counts as dry from the start.
    select coalesce(p_watered, p_settled - private.moist_for()) + private.moist_for() as until
  ) m;
$$;

-- When a bed's crop ripens (or ripened), if it isn't watered again.
create or replace function private.ripe_moment(
  p_grown   double precision,
  p_target  double precision,
  p_settled timestamptz,
  p_watered timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_grown >= p_target then p_settled
    -- Ripe before the watering wears off...
    when p_target - p_grown <= private.watered_speed() * m.secs
      then p_settled + make_interval(secs => (p_target - p_grown) / private.watered_speed())
    -- ...or after it, growing at the plain pace for the rest.
    else p_settled + make_interval(secs => m.secs + (p_target - p_grown) - private.watered_speed() * m.secs)
  end
  from (
    select greatest(0, extract(epoch from
      coalesce(p_watered, p_settled - private.moist_for()) + private.moist_for() - p_settled
    )::double precision) as secs
  ) m;
$$;

-- Every bed with its crop's state right now. ripe_at can be in the future:
-- it's when the crop will be ripe if nobody waters it again.
create or replace view private.beds as
  select
    b.user_id,
    b.bed,
    b.crop,
    b.planted_at,
    b.watered_at,
    c.grow_hours,
    c.yield,
    c.grow_hours * 3600.0::double precision as target_s,
    least(1, private.growth_at(b.grown_s, b.settled_at, b.watered_at, now())
               / (c.grow_hours * 3600.0)) as progress,
    r.ripe_at,
    r.ripe_at + private.keeps_for() as withers_at,
    r.ripe_at <= now() and now() < r.ripe_at + private.keeps_for() as ripe,
    now() >= r.ripe_at + private.keeps_for() as withered,
    coalesce(b.watered_at + private.moist_for() > now(), false) as watered
  from public.plots b
  join public.crops c on c.produce = b.crop
  cross join lateral (
    select private.ripe_moment(b.grown_s, c.grow_hours * 3600.0, b.settled_at, b.watered_at) as ripe_at
  ) r;

revoke all on private.beds from public, anon, authenticated;

create or replace function private.plots_of(p_user_id uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'bed',        b.bed,
    'crop',       b.crop,
    'progress',   b.progress,
    'grow_hours', b.grow_hours,
    'ripe',       b.ripe,
    'withered',   b.withered,
    'ripe_at',    b.ripe_at,
    'withers_at', b.withers_at,
    'watered',    b.watered,
    'dry_at',     b.watered_at + private.moist_for(),
    'planted_at', b.planted_at
  ) order by b.bed), '[]'::json)
  from private.beds b
  where b.user_id = p_user_id;
$$;

-- Waters a player's beds that are still growing: each one's growth so far is
-- settled, then the new watering starts. (Ripe and withered crops are done
-- with water.)
create or replace function private.water_beds(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plots b
     set grown_s    = least(c.grow_hours * 3600.0,
                            private.growth_at(b.grown_s, b.settled_at, b.watered_at, now())),
         settled_at = now(),
         watered_at = now()
    from public.crops c
   where c.produce = b.crop
     and b.user_id = p_user_id
     and private.ripe_moment(b.grown_s, c.grow_hours * 3600.0, b.settled_at, b.watered_at) > now();
$$;

-- Sessions no longer grow crops: completing one just pays out (as in 0003).
create or replace function private.finalize_expired(p_user_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.sessions s
       set status   = 'completed',
           ended_at = s.started_at + make_interval(mins => s.duration_min),
           -- Two random numbers summed: mostly close to even, rarely the full 12%.
           chips    = greatest(1, s.duration_min
                        + round((random() + random() - 1) * 0.12 * s.duration_min)::integer)
     where s.user_id = any (p_user_ids)
       and s.status = 'active'
       and s.started_at + make_interval(mins => s.duration_min) <= now()
    returning s.user_id, s.chips
  )
  update public.profiles p
     set chips = p.chips + t.total
    from (select user_id, sum(chips)::integer as total from done group by user_id) t
   where p.id = t.user_id;
$$;

-- Planting no longer waters the seed in: it grows at its own pace until
-- someone waters it.
create or replace function public.plant(p_bed integer, p_seed text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_crop text;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  if p_bed is null or p_bed not between 0 and 3 then
    raise exception 'There''s no bed %', p_bed;
  end if;

  select produce into v_crop from public.crops where seed = p_seed;
  if v_crop is null then
    raise exception 'Those aren''t seeds';
  end if;

  if exists (select 1 from public.plots where user_id = v_uid and bed = p_bed) then
    raise exception 'Something is already growing there';
  end if;

  perform private.take_item(v_uid, p_seed, 1);
  insert into public.plots (user_id, bed, crop, planted_at, settled_at)
  values (v_uid, p_bed, v_crop, now(), now());

  return public.get_garden();
end;
$$;

-- Waters every bed you have. Free and unlimited: it's a ritual, not a chore.
create or replace function public.water()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);
  perform private.water_beds(v_uid);
  return public.get_garden();
end;
$$;

create or replace function public.water_friend(p_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_friend uuid;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select f.friend_id into v_friend
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid and p.username = lower(trim(p_username));

  if v_friend is null then
    raise exception 'You can only water a friend''s plot';
  end if;

  perform private.water_beds(v_friend);
  return public.get_garden();
end;
$$;

create or replace function public.harvest(p_bed integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_bed record;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select crop, yield, ripe, withered into v_bed
  from private.beds where user_id = v_uid and bed = p_bed;

  if v_bed.withered then
    raise exception 'It''s withered: there''s nothing to pick. Clear the bed instead';
  end if;
  if v_bed.ripe is not true then
    raise exception 'Nothing is ripe there yet';
  end if;

  delete from public.plots where user_id = v_uid and bed = p_bed;
  perform private.add_item(v_uid, v_bed.crop, v_bed.yield);

  return public.get_garden();
end;
$$;

-- Pulls up a withered crop and puts it on the compost, freeing the bed.
create or replace function public.clear_bed(p_bed integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  if not exists (
    select 1 from private.beds where user_id = v_uid and bed = p_bed and withered
  ) then
    raise exception 'There''s nothing withered there';
  end if;

  delete from public.plots where user_id = v_uid and bed = p_bed;
  return public.get_garden();
end;
$$;

create or replace function public.get_shop()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return json_build_object(
    'chips', (select chips from public.profiles where id = v_uid),
    'items', (
      select coalesce(json_agg(json_build_object(
        'slug',       it.slug,
        'kind',       it.kind,
        'name',       it.name,
        'price',      it.price,
        'pack_size',  it.pack_size,
        'owned',      coalesce(inv.qty, 0),
        'grow_hours', c.grow_hours,
        'yield',      c.yield
      ) order by array_position(array['vehicle', 'desk', 'seed', 'cigarette'], it.kind), it.sort), '[]'::json)
      from public.items it
      left join public.inventory inv on inv.user_id = v_uid and inv.item = it.slug
      left join public.crops c on c.seed = it.slug
      where it.price is not null
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Where you are at work
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Where you are while you're at work: at your desk ('office'), in the
  -- garden, or out in the car park. Null when you're not at work.
  add column place text check (place in ('office', 'garden', 'outside')),
  -- When your app last checked in (get_me, every few seconds while it's open)
  -- while you were at work.
  add column seen_at timestamptz;

-- As in 0003, plus: while your app is open at your desk or in the garden,
-- you're at work, however long ago your break ended.
create or replace function private.presence(p_user_id uuid)
returns table (status text, ends_at timestamptz, break_ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ends_at   timestamptz;
  v_last      record;
  v_profile   record;
  v_free_at   timestamptz;
  v_since     timestamptz;
begin
  select s.started_at + make_interval(mins => s.duration_min) into v_ends_at
  from public.sessions s
  where s.user_id = p_user_id and s.status = 'active';

  if v_ends_at > now() then
    return query select 'focused'::text, v_ends_at, null::timestamptz;
    return;
  end if;

  select p.went_home_at, p.arrived_at, p.place, p.seen_at into v_profile
  from public.profiles p where p.id = p_user_id;

  select s.status, s.ended_at, s.duration_min into v_last
  from public.sessions s
  where s.user_id = p_user_id and s.status in ('completed', 'cancelled')
  order by s.ended_at desc
  limit 1;

  -- A completed session earns a break; a cancelled one frees you straight away.
  if v_last.ended_at is not null then
    v_free_at := case
      when v_last.status = 'completed'
        then v_last.ended_at + make_interval(mins => private.break_minutes(v_last.duration_min))
      else v_last.ended_at
    end;
  end if;

  -- The last moment you were known to be at work.
  v_since := greatest(v_profile.arrived_at, v_last.ended_at);

  return query select
    case
      when v_since is null or v_profile.went_home_at >= v_since then 'absent'
      when v_last.status = 'completed' and now() < v_free_at
        and (v_profile.went_home_at is null or v_profile.went_home_at < v_last.ended_at) then 'on_break'
      when now() < greatest(v_free_at, v_profile.arrived_at) + interval '15 minutes' then 'idle'
      when v_profile.place in ('office', 'garden')
        and v_profile.seen_at > now() - interval '2 minutes' then 'idle'
      else 'absent'
    end,
    null::timestamptz,
    case when v_last.status = 'completed' then v_free_at end;
end;
$$;

-- Moves you: 'office' (your desk, handing you one if you've just arrived),
-- 'garden' or 'outside' (the car park). Mid-session you're at your desk
-- whatever you ask, and when you're not at work you're nowhere.
create or replace function public.set_place(p_place text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_place  text := p_place;
  v_status text;
begin
  if v_place is null or v_place not in ('office', 'garden', 'outside') then
    raise exception 'There''s nowhere called %', coalesce(v_place, 'that');
  end if;

  if v_place = 'office' then
    perform private.arrive(v_uid);
  else
    perform private.finalize_expired(array[v_uid]);
  end if;

  v_status := private.status_of(v_uid);
  if v_status = 'focused' then
    v_place := 'office';
  elsif v_status = 'absent' then
    v_place := null;
  end if;

  update public.profiles
     set place = v_place,
         seen_at = case when v_place is null then seen_at else now() end
   where id = v_uid;
  return public.get_me();
end;
$$;

-- Walking into the office (kept for older apps).
create or replace function public.arrive()
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.set_place('office');
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

  -- Sitting down counts as arriving, if you somehow hadn't.
  perform private.arrive(v_uid);
  insert into public.sessions (user_id, duration_min) values (v_uid, p_minutes);
  -- Sitting down at your desk ends whatever you were doing in the garden.
  update public.profiles
     set activity = null, activity_until = null, place = 'office', seen_at = now()
   where id = v_uid;

  return public.get_me();
end;
$$;

create or replace function public.go_home()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);

  if private.status_of(v_uid) = 'focused' then
    raise exception 'Give up the session before going home';
  end if;

  update public.profiles
     set went_home_at = now(), activity = null, activity_until = null, place = null
   where id = v_uid;

  return public.get_me();
end;
$$;

-- As in 0005, plus 'place'; ripe crops the new way; and checking in keeps you
-- at work while your app is open in the office or the garden.
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
        'started_at',   s.started_at,
        'duration_min', s.duration_min,
        'ends_at',      s.started_at + make_interval(mins => s.duration_min)
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
    'ripe', (
      select coalesce(json_agg(json_build_object(
        'bed',        b.bed,
        'crop',       b.crop,
        'withers_at', b.withers_at
      ) order by b.ripe_at, b.bed), '[]'::json)
      from private.beds b
      where b.user_id = v_uid and b.ripe
    ),
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

-- As in 0003, plus where each friend is ('office' means at their desk).
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
        pr.status,
        pr.ends_at,
        pr.break_ends_at,
        case when pr.status <> 'absent' then p.desk end as desk,
        case
          when pr.status = 'focused' then 'office'
          when pr.status <> 'absent' then p.place
        end as place,
        p.arrived_at,
        p.vehicle,
        (
          select coalesce(json_agg(i.item order by it.sort), '[]'::json)
          from public.inventory i
          join public.items it on it.slug = i.item
          where i.user_id = p.id and it.kind = 'desk'
        ) as desk_items,
        case when p.activity_until > now() then p.activity end as activity
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_friends)
    ) b
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Testing tools (0005), the new way
-- ---------------------------------------------------------------------------

-- Skips you forward in time: everything timed about you moves back, beds
-- included, so crops grow (and wither) as if that time had passed.
create or replace function public.dev_skip(p_minutes integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_by  interval;
begin
  perform private.require_tester(v_uid);
  if p_minutes is null or p_minutes not between 1 and 20160 then
    raise exception 'Skip 1 minute to 2 weeks at a time';
  end if;
  v_by := make_interval(mins => p_minutes);

  update public.sessions
     set started_at = started_at - v_by,
         ended_at   = ended_at - v_by
   where user_id = v_uid;
  update public.profiles
     set went_home_at   = went_home_at - v_by,
         arrived_at     = arrived_at - v_by,
         activity_until = activity_until - v_by,
         seen_at        = seen_at - v_by
   where id = v_uid;
  update public.plots
     set planted_at = planted_at - v_by,
         watered_at = watered_at - v_by,
         settled_at = settled_at - v_by
   where user_id = v_uid;

  return public.get_me();
end;
$$;

-- Ripens everything growing in your beds, as of now.
create or replace function public.dev_ripen()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.require_tester(v_uid);
  update public.plots b
     set grown_s = c.grow_hours * 3600.0,
         settled_at = now()
    from public.crops c
   where c.produce = b.crop
     and b.user_id = v_uid
     and private.ripe_moment(b.grown_s, c.grow_hours * 3600.0, b.settled_at, b.watered_at) > now();
  return public.get_me();
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function public.set_place(text) from public, anon;
grant execute on function public.set_place(text) to authenticated;
