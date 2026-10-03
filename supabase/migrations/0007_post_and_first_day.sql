-- Focus, part 7: staying focused, a first day, and more to do in the garden.
--   * leaving the page while you study stops the session: no chips, no break.
--     The app says when you leave (and when you're back); 10 seconds away is
--     forgiven, in case of a slip of the thumb. Only the page you started on
--     counts, so a phone left open beside a laptop can't stop its session.
--   * your first session can be skipped (it counts as at most 25 minutes), so
--     new players can look round the garden before they've studied
--   * tips for new players, remembered per account
--   * a post box in the garden: write letters to friends and pick yours up
--   * bins: throw away crops, seeds and cigarettes you don't want
--   * one seed makes one plant, and a bed holds up to four
--   * a cigarette burns out after 3 minutes
-- Run after 0006_growing_and_desks.sql: SQL Editor -> New query -> paste this file -> Run.

-- ---------------------------------------------------------------------------
-- Leaving the page stops your session
-- ---------------------------------------------------------------------------

alter table public.sessions
  -- The page the session was started on (a random id the app keeps per tab).
  add column device  text check (char_length(device) <= 64),
  -- While it runs: when that device left the page (null while you're there).
  -- On a cancelled session: you left, and that's when.
  add column left_at timestamptz;

-- How long you can be away from the page before your session stops.
create or replace function private.away_grace()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '10 seconds';
$$;

-- As in 0006, plus: a session whose page was left for longer than the grace
-- (before it ended) stops at the moment you left, and pays nothing.
create or replace function private.finalize_expired(p_user_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  with left_page as (
    update public.sessions s
       set status   = 'cancelled',
           ended_at = s.left_at
     where s.user_id = any (p_user_ids)
       and s.status = 'active'
       and s.left_at + private.away_grace() <= now()
       and s.left_at + private.away_grace() < s.started_at + make_interval(mins => s.duration_min)
    returning s.id
  ),
  done as (
    update public.sessions s
       set status   = 'completed',
           ended_at = s.started_at + make_interval(mins => s.duration_min),
           -- Two random numbers summed: mostly close to even, rarely the full 12%.
           chips    = greatest(1, s.duration_min
                        + round((random() + random() - 1) * 0.12 * s.duration_min)::integer)
     where s.user_id = any (p_user_ids)
       and s.status = 'active'
       and s.started_at + make_interval(mins => s.duration_min) <= now()
       and (s.left_at is null
            or s.left_at + private.away_grace() >= s.started_at + make_interval(mins => s.duration_min))
    returning s.user_id, s.chips
  )
  update public.profiles p
     set chips = p.chips + t.total
    from (select user_id, sum(chips)::integer as total from done group by user_id) t
   where p.id = t.user_id;
$$;

-- As in 0006, plus the page you start on, so only leaving that page counts.
drop function public.start_session(integer);
create function public.start_session(p_minutes integer, p_device text default null)
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
  insert into public.sessions (user_id, duration_min, device)
  values (v_uid, p_minutes, left(p_device, 64));
  -- Sitting down at your desk ends whatever you were doing in the garden.
  update public.profiles
     set activity = null, activity_until = null, place = 'office', seen_at = now()
   where id = v_uid;

  return public.get_me();
end;
$$;

-- The page a session was started on was hidden (another app, another tab, the
-- phone locked). Come back within the grace and nothing happens.
create or replace function public.leave_page(p_session bigint, p_device text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);
  update public.sessions
     set left_at = coalesce(left_at, now())
   where id = p_session
     and user_id = v_uid
     and status = 'active'
     and device is not distinct from p_device;
end;
$$;

-- That page is showing again. p_away_s is how long the app says it was away,
-- in case word that it left never reached us (no signal, say): if the session
-- has finished since, without you, it's taken back.
create or replace function public.back_to_page(
  p_session bigint,
  p_device  text default null,
  p_away_s  integer default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_left timestamptz;
  v_paid integer;
begin
  if p_away_s > 0 then
    v_left := now() - make_interval(secs => least(p_away_s, 86400));

    update public.sessions
       set left_at = least(coalesce(left_at, 'infinity'), greatest(started_at, v_left))
     where id = p_session
       and user_id = v_uid
       and status = 'active'
       and device is not distinct from p_device;

    with undone as (
      update public.sessions s
         set status   = 'cancelled',
             left_at  = greatest(s.started_at, v_left),
             ended_at = greatest(s.started_at, v_left),
             chips    = null
        from (
          select id, chips from public.sessions
          where id = p_session
            and user_id = v_uid
            and status = 'completed'
            and device is not distinct from p_device
            and ended_at > now() - interval '1 day'
            and greatest(started_at, v_left) + private.away_grace() < ended_at
        ) old
       where s.id = old.id
      returning old.chips
    )
    select coalesce(sum(chips), 0)::integer into v_paid from undone;

    if v_paid > 0 then
      update public.profiles set chips = greatest(0, chips - v_paid) where id = v_uid;
    end if;
  end if;

  perform private.finalize_expired(array[v_uid]);

  -- Back in time: carry on.
  update public.sessions
     set left_at = null
   where id = p_session
     and user_id = v_uid
     and status = 'active'
     and device is not distinct from p_device;

  return public.get_me();
end;
$$;

-- ---------------------------------------------------------------------------
-- A first day: skipping the first session, and tips
-- ---------------------------------------------------------------------------

-- Ends your first ever session now, as if you'd studied it (25 minutes at
-- most), so you can see the payout and the garden before you've studied.
create or replace function public.skip_first_session()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);

  if exists (select 1 from public.sessions where user_id = v_uid and status = 'completed') then
    raise exception 'Only your first session can be skipped';
  end if;

  update public.sessions
     set duration_min = least(duration_min, 25),
         started_at   = now() - make_interval(mins => least(duration_min, 25)),
         left_at      = null
   where user_id = v_uid and status = 'active';

  if not found then
    raise exception 'No session is running';
  end if;

  perform private.finalize_expired(array[v_uid]);
  return public.get_me();
end;
$$;

-- Tips a player has seen through or put away.
alter table public.profiles add column tips text[] not null default '{}';

create or replace function public.done_tip(p_tip text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_tip is null or p_tip !~ '^[a-z_]{1,32}$' then
    raise exception 'There''s no tip called %', coalesce(p_tip, 'that');
  end if;
  update public.profiles
     set tips = array_append(tips, p_tip)
   where id = v_uid
     and not (p_tip = any (tips))
     and cardinality(tips) < 64;
  return public.get_me();
end;
$$;

create or replace function public.reset_tips()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.profiles set tips = '{}' where id = v_uid;
  return public.get_me();
end;
$$;

-- ---------------------------------------------------------------------------
-- The post box
-- ---------------------------------------------------------------------------

create table public.letters (
  id        bigint generated always as identity primary key,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user   uuid not null references public.profiles (id) on delete cascade,
  body      text not null check (char_length(body) between 1 and 1000),
  sent_at   timestamptz not null default now(),
  -- When it was picked up from the post box; null while it's waiting there.
  read_at   timestamptz,
  check (from_user <> to_user)
);

create index letters_to_user on public.letters (to_user, sent_at desc);
create index letters_from_user on public.letters (from_user, sent_at desc);

alter table public.letters enable row level security;

create policy "read letters to or from you" on public.letters
  for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

-- Letters to you (newest first) and the ones you've sent, with names.
create or replace function private.post_of(p_user_id uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'letters', (
      select coalesce(json_agg(json_build_object(
        'id',        l.id,
        'from',      p.username,
        'from_name', p.display_name,
        'body',      l.body,
        'sent_at',   l.sent_at,
        'read_at',   l.read_at
      ) order by l.sent_at desc), '[]'::json)
      from (
        select * from public.letters
        where to_user = p_user_id
        order by sent_at desc
        limit 50
      ) l
      join public.profiles p on p.id = l.from_user
    ),
    'sent', (
      select coalesce(json_agg(json_build_object(
        'id',        l.id,
        'to',        p.username,
        'to_name',   p.display_name,
        'body',      l.body,
        'sent_at',   l.sent_at,
        'read_at',   l.read_at
      ) order by l.sent_at desc), '[]'::json)
      from (
        select * from public.letters
        where from_user = p_user_id
        order by sent_at desc
        limit 20
      ) l
      join public.profiles p on p.id = l.to_user
    ),
    'waiting', (
      select count(*)::integer from public.letters
      where to_user = p_user_id and read_at is null
    ),
    'server_now', now()
  );
$$;

create or replace function public.get_post()
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.post_of(private.require_uid());
end;
$$;

-- Posts a letter to a friend. It waits in the post box until they pick it up.
create or replace function public.send_letter(p_to text, p_body text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_friend uuid;
  v_body   text := trim(p_body);
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select f.friend_id into v_friend
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid and p.username = lower(trim(p_to));

  if v_friend is null then
    raise exception 'You can only write to friends';
  end if;
  if v_body is null or v_body = '' then
    raise exception 'Write something first';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'Letters can be up to 1000 characters';
  end if;
  if (
    select count(*) from public.letters
    where from_user = v_uid and sent_at > now() - interval '1 day'
  ) >= 50 then
    raise exception 'That''s a lot of post for one day. Try again tomorrow';
  end if;

  insert into public.letters (from_user, to_user, body) values (v_uid, v_friend, v_body);
  return private.post_of(v_uid);
end;
$$;

-- Takes everything waiting for you out of the post box.
create or replace function public.pick_up_post()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.letters set read_at = now() where to_user = v_uid and read_at is null;
  return private.post_of(v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- The bins
-- ---------------------------------------------------------------------------

create or replace function public.bin_item(p_item text, p_qty integer)
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

  if not private.is_tradeable(p_item) then
    raise exception 'Only crops, seeds and cigarettes go in the bins';
  end if;
  if p_qty is null or p_qty not between 1 and 9999 then
    raise exception 'Throw away 1 to 9999 at a time';
  end if;

  perform private.take_item(v_uid, p_item, p_qty);
  return public.get_garden();
end;
$$;

-- ---------------------------------------------------------------------------
-- Cigarettes burn out sooner
-- ---------------------------------------------------------------------------

create or replace function private.smoke_for()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '3 minutes';
$$;

create or replace function public.smoke()
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

  if exists (
    select 1 from public.profiles
    where id = v_uid and activity = 'smoking' and activity_until > now()
  ) then
    raise exception 'You''re already having one';
  end if;

  perform private.take_item(v_uid, 'cigarette', 1);
  update public.profiles
     set activity = 'smoking', activity_until = now() + private.smoke_for()
   where id = v_uid;

  return public.get_garden();
end;
$$;

-- ---------------------------------------------------------------------------
-- One seed, one plant; four plants to a bed
-- ---------------------------------------------------------------------------

alter table public.plots
  add column spot smallint not null default 0 check (spot between 0 and 3);
alter table public.plots drop constraint plots_pkey;
alter table public.plots add primary key (user_id, bed, spot);

-- A radish or carrot plant gives one root. (Strawberries, tomatoes,
-- sunflowers and pumpkins already gave what one plant does.)
update public.crops set yield = 1 where produce in ('radish', 'carrot');

-- As in 0006, plus each plant's spot in its bed.
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
    coalesce(b.watered_at + private.moist_for() > now(), false) as watered,
    b.spot
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
    'spot',       b.spot,
    'crop',       b.crop,
    'progress',   b.progress,
    'grow_hours', b.grow_hours,
    'yield',      b.yield,
    'ripe',       b.ripe,
    'withered',   b.withered,
    'ripe_at',    b.ripe_at,
    'withers_at', b.withers_at,
    'watered',    b.watered,
    'dry_at',     b.watered_at + private.moist_for(),
    'planted_at', b.planted_at
  ) order by b.bed, b.spot), '[]'::json)
  from private.beds b
  where b.user_id = p_user_id;
$$;

-- Plants one seed in the next free spot of a bed.
create or replace function public.plant(p_bed integer, p_seed text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_crop text;
  v_spot smallint;
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

  select s into v_spot
  from generate_series(0, 3) s
  where not exists (
    select 1 from public.plots where user_id = v_uid and bed = p_bed and spot = s
  )
  order by s
  limit 1;

  if v_spot is null then
    raise exception 'That bed''s full: it holds four plants';
  end if;

  perform private.take_item(v_uid, p_seed, 1);
  insert into public.plots (user_id, bed, spot, crop, planted_at, settled_at)
  values (v_uid, p_bed, v_spot, v_crop, now(), now());

  return public.get_garden();
end;
$$;

-- Picks everything ripe in a bed.
create or replace function public.harvest(p_bed integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_plant  record;
  v_picked boolean := false;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  for v_plant in
    select spot, crop, yield from private.beds where user_id = v_uid and bed = p_bed and ripe
  loop
    v_picked := true;
    delete from public.plots where user_id = v_uid and bed = p_bed and spot = v_plant.spot;
    perform private.add_item(v_uid, v_plant.crop, v_plant.yield);
  end loop;

  if not v_picked then
    if exists (select 1 from private.beds where user_id = v_uid and bed = p_bed and withered) then
      raise exception 'It''s withered: there''s nothing to pick. Clear the bed instead';
    end if;
    raise exception 'Nothing is ripe there yet';
  end if;

  return public.get_garden();
end;
$$;

-- Pulls up whatever has withered in a bed, freeing those spots.
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

  delete from public.plots b
   using private.beds r
   where b.user_id = v_uid
     and b.bed = p_bed
     and r.user_id = b.user_id
     and r.bed = b.bed
     and r.spot = b.spot
     and r.withered;

  if not found then
    raise exception 'There''s nothing withered there';
  end if;

  return public.get_garden();
end;
$$;

-- ---------------------------------------------------------------------------
-- What the app knows about you
-- ---------------------------------------------------------------------------

-- As in 0006, plus: the running session's id, how many sessions you've
-- finished, your tips, letters waiting for you, and the session you stopped
-- by leaving the page (if that was your last one, in the last 12 hours).
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

-- Testing tools: skipping ahead moves when you left the page, too.
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
         ended_at   = ended_at - v_by,
         left_at    = left_at - v_by
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

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.start_session(integer, text),
  public.leave_page(bigint, text),
  public.back_to_page(bigint, text, integer),
  public.skip_first_session(),
  public.done_tip(text),
  public.reset_tips(),
  public.get_post(),
  public.send_letter(text, text),
  public.pick_up_post(),
  public.bin_item(text, integer)
from public, anon;

grant execute on function
  public.start_session(integer, text),
  public.leave_page(bigint, text),
  public.back_to_page(bigint, text, integer),
  public.skip_first_session(),
  public.done_tip(text),
  public.reset_tips(),
  public.get_post(),
  public.send_letter(text, text),
  public.pick_up_post(),
  public.bin_item(text, integer)
to authenticated;
