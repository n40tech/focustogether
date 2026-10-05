-- Focus, part 5: testing tools.
--   * a "tester" flag on profiles, set only from the SQL editor
--   * for testers, dev_* functions: add chips, skip ahead in time, get items,
--     ripen crops. The app shows a Test button to testers.
-- Run after 0004_withering.sql: SQL Editor -> New query -> paste this file -> Run.
-- Then turn the tools on for your account:
--   update public.profiles set tester = true where username = '<you>';

alter table public.profiles add column tester boolean not null default false;

create or replace function private.require_tester(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select tester from public.profiles where id = p_user_id), false) then
    raise exception 'The testing tools are off for this account';
  end if;
end;
$$;

-- Adds (or with a negative amount, takes away) chips. Never below 0.
create or replace function public.dev_chips(p_amount integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.require_tester(v_uid);
  if p_amount is null or abs(p_amount) > 100000 then
    raise exception 'Up to 100000 chips at a time';
  end if;
  update public.profiles set chips = greatest(0, chips + p_amount) where id = v_uid;
  return public.get_me();
end;
$$;

-- Skips you forward in time. The server's clock can't move, so instead
-- everything timed about you moves back: your sessions, arriving, going home,
-- smoking, and your beds (planting, watering, ripening). A session that would
-- have ended in that time ends (and pays out, and grows your crops) as usual;
-- a break that would have run out has. Friends' clocks don't move.
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
         activity_until = activity_until - v_by
   where id = v_uid;
  update public.plots
     set planted_at = planted_at - v_by,
         watered_at = watered_at - v_by,
         ripe_at    = ripe_at - v_by
   where user_id = v_uid;

  return public.get_me();
end;
$$;

-- Puts any item from the catalogue in your basket. Vehicles and desk things
-- are one-offs, as in the shop: you get one if you haven't one, and a vehicle
-- becomes the one you arrive in.
create or replace function public.dev_item(p_item text, p_qty integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_kind text;
begin
  perform private.require_tester(v_uid);
  select kind into v_kind from public.items where slug = p_item;
  if v_kind is null then
    raise exception 'There''s no item called %', p_item;
  end if;
  if p_qty is null or p_qty not between 1 and 99 then
    raise exception 'Give 1 to 99 at a time';
  end if;

  if v_kind in ('vehicle', 'desk') then
    if not exists (select 1 from public.inventory where user_id = v_uid and item = p_item) then
      perform private.add_item(v_uid, p_item, 1);
    end if;
    if v_kind = 'vehicle' then
      update public.profiles set vehicle = p_item where id = v_uid;
    end if;
  else
    perform private.add_item(v_uid, p_item, p_qty);
  end if;
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
     set growth_min = c.grow_min,
         ripe_at    = now()
    from public.crops c
   where c.produce = b.crop
     and b.user_id = v_uid
     and b.growth_min < c.grow_min;
  return public.get_me();
end;
$$;

-- As in 0004, plus 'tester', so the app knows to show the testing tools.
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
    'id',             p.id,
    'username',       p.username,
    'display_name',   p.display_name,
    'chips',          p.chips,
    'status',         pr.status,
    'break_ends_at',  pr.break_ends_at,
    'desk',           case when pr.status <> 'absent' then p.desk end,
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
        'withers_at', b.ripe_at + private.keeps_for()
      ) order by b.ripe_at, b.bed), '[]'::json)
      from public.plots b
      join public.crops c on c.produce = b.crop
      where b.user_id = v_uid
        and b.growth_min >= c.grow_min
        and coalesce(b.ripe_at + private.keeps_for() > now(), true)
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

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.dev_chips(integer),
  public.dev_skip(integer),
  public.dev_item(text, integer),
  public.dev_ripen()
from public, anon;

grant execute on function
  public.dev_chips(integer),
  public.dev_skip(integer),
  public.dev_item(text, integer),
  public.dev_ripen()
to authenticated;
