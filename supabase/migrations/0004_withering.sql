-- Focus, part 4: crops wither if they're left too long.
--   * a ripe crop keeps for 2 days after it ripens; then it withers
--   * a withered crop gives nothing, and stays in its bed until you clear it
--   * get_me says what's ripe, so the payout can mention it
-- Run after 0003_community.sql: SQL Editor -> New query -> paste this file -> Run.

-- When the crop ripened: the end of the session that took it to its grow_min.
-- Null while it's growing.
alter table public.plots add column ripe_at timestamptz;

-- Anything already ripe gets the full two days from now.
update public.plots b
   set ripe_at = now()
  from public.crops c
 where c.produce = b.crop
   and b.growth_min >= c.grow_min;

-- How long a ripe crop keeps before it withers. The one number to tune.
create or replace function private.keeps_for()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '2 days';
$$;

-- A bed's crop, as the garden shows it. Ripe means ripe and still good.
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
    'growth_min', b.growth_min,
    'grow_min',   c.grow_min,
    'ripe',       b.growth_min >= c.grow_min and not w.withered,
    'withered',   w.withered,
    'ripe_at',    b.ripe_at,
    'withers_at', b.ripe_at + private.keeps_for(),
    'watered',    coalesce(b.watered_at > now() - interval '24 hours', false),
    'planted_at', b.planted_at
  ) order by b.bed), '[]'::json)
  from public.plots b
  join public.crops c on c.produce = b.crop
  cross join lateral (
    select coalesce(b.ripe_at + private.keeps_for() <= now(), false) as withered
  ) w
  where b.user_id = p_user_id;
$$;

-- As in 0003, plus: a crop that reaches its grow_min is stamped ripe as of the
-- end of the session that ripened it (sessions are completed lazily, so that
-- can be a little in the past).
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
    returning s.user_id, s.started_at, s.ended_at, s.duration_min, s.chips
  ),
  paid as (
    update public.profiles p
       set chips = p.chips + t.total
      from (select user_id, sum(chips)::integer as total from done group by user_id) t
     where p.id = t.user_id
  )
  update public.plots b
     set growth_min = least(c.grow_min, b.growth_min + g.mins),
         ripe_at    = case
                        when b.ripe_at is null and b.growth_min + g.mins >= c.grow_min
                          then g.ended_at
                        else b.ripe_at
                      end
    from (
      select pl.user_id, pl.bed, sum(d.duration_min)::integer as mins, max(d.ended_at) as ended_at
      from done d
      join public.plots pl on pl.user_id = d.user_id
      where pl.planted_at <= d.started_at
        and pl.watered_at >= d.ended_at - interval '24 hours'
      group by pl.user_id, pl.bed
    ) g,
    public.crops c
   where b.user_id = g.user_id
     and b.bed = g.bed
     and c.produce = b.crop;
$$;

create or replace function public.harvest(p_bed integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_crop  text;
  v_yield integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  if exists (
    select 1 from public.plots
    where user_id = v_uid and bed = p_bed and ripe_at + private.keeps_for() <= now()
  ) then
    raise exception 'It''s withered: there''s nothing to pick. Clear the bed instead';
  end if;

  delete from public.plots b
   using public.crops c
   where b.user_id = v_uid
     and b.bed = p_bed
     and c.produce = b.crop
     and b.growth_min >= c.grow_min
  returning b.crop, c.yield into v_crop, v_yield;

  if v_crop is null then
    raise exception 'Nothing is ripe there yet';
  end if;

  perform private.add_item(v_uid, v_crop, v_yield);

  return public.get_garden();
end;
$$;

-- Pulls up a withered crop and puts it on the compost, freeing the bed. Only
-- withered ones: a growing or ripe crop is never lost by a slip of the thumb.
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

  delete from public.plots
   where user_id = v_uid
     and bed = p_bed
     and ripe_at + private.keeps_for() <= now();

  if not found then
    raise exception 'There''s nothing withered there';
  end if;

  return public.get_garden();
end;
$$;

-- As in 0003, plus 'ripe': your crops that are ready to pick, and when each
-- would wither.
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

revoke execute on function public.clear_bed(integer) from public, anon;
grant execute on function public.clear_bed(integer) to authenticated;
