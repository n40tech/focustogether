-- Focus game layer: poker chips, earned breaks, the kiosk (shop), vehicles,
-- desk items, allotments, produce, cigarettes, trades and garden chat.
-- Run after 0001_init.sql: SQL Editor -> New query -> paste this file -> Run.
--
-- Same conventions as 0001: RLS only allows reads, every change goes through a
-- security-definer function below that uses auth.uid(), and status is derived
-- from timestamps at read time. See docs/PLAN.md for the rules in plain words.

-- ---------------------------------------------------------------------------
-- Profiles: points become poker chips, "left" becomes "went home".
-- ---------------------------------------------------------------------------

alter table public.profiles rename column points to chips;
alter table public.profiles rename column left_at to went_home_at;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.items (
  slug      text primary key check (slug ~ '^[a-z][a-z0-9_]*$'),
  kind      text not null check (kind in ('vehicle', 'desk', 'seed', 'produce', 'cigarette')),
  name      text not null,
  -- Chips per purchase. Null means the kiosk doesn't sell it (produce is grown).
  price     integer check (price > 0),
  -- How many you get per purchase (seed packets, cigarette packs).
  pack_size integer not null default 1 check (pack_size > 0),
  sort      integer not null default 0
);

create table public.crops (
  produce   text primary key references public.items (slug),
  seed      text not null unique references public.items (slug),
  grow_min  integer not null check (grow_min > 0),  -- study minutes to ripen
  yield     integer not null check (yield > 0),     -- produce per harvest
  seeds_per integer not null check (seeds_per > 0)  -- seeds saved from one produce
);

-- Placeholder prices, tuned to 1 chip per minute studied.
insert into public.items (slug, kind, name, price, pack_size, sort) values
  ('bike',             'vehicle',   'Bicycle',            60, 1, 10),
  ('hatchback',        'vehicle',   'Hatchback',         300, 1, 20),
  ('estate',           'vehicle',   'Estate car',        500, 1, 30),
  ('campervan',        'vehicle',   'Campervan',         800, 1, 40),
  ('roadster',         'vehicle',   'Vintage roadster', 1200, 1, 50),
  ('mug',              'desk',      'Mug',                10, 1, 10),
  ('duck',             'desk',      'Rubber duck',        15, 1, 20),
  ('succulent',        'desk',      'Succulent',          20, 1, 30),
  ('photo',            'desk',      'Photo frame',        30, 1, 40),
  ('lamp',             'desk',      'Desk lamp',          40, 1, 50),
  ('lava_lamp',        'desk',      'Lava lamp',          60, 1, 60),
  ('radio',            'desk',      'Radio',              80, 1, 70),
  ('bonsai',           'desk',      'Bonsai',            150, 1, 80),
  ('radish_seeds',     'seed',      'Radish seeds',        6, 3, 10),
  ('carrot_seeds',     'seed',      'Carrot seeds',        8, 3, 20),
  ('sunflower_seeds',  'seed',      'Sunflower seeds',    10, 3, 30),
  ('strawberry_seeds', 'seed',      'Strawberry seeds',   12, 3, 40),
  ('tomato_seeds',     'seed',      'Tomato seeds',       15, 3, 50),
  ('pumpkin_seeds',    'seed',      'Pumpkin seeds',      25, 3, 60),
  ('radish',           'produce',   'Radish',           null, 1, 10),
  ('carrot',           'produce',   'Carrot',           null, 1, 20),
  ('sunflower',        'produce',   'Sunflower',        null, 1, 30),
  ('strawberry',       'produce',   'Strawberry',       null, 1, 40),
  ('tomato',           'produce',   'Tomato',           null, 1, 50),
  ('pumpkin',          'produce',   'Pumpkin',          null, 1, 60),
  ('cigarette',        'cigarette', 'Cigarettes',          8, 5, 10);

insert into public.crops (produce, seed, grow_min, yield, seeds_per) values
  ('radish',     'radish_seeds',      25, 3, 2),
  ('carrot',     'carrot_seeds',      50, 3, 2),
  ('sunflower',  'sunflower_seeds',  180, 1, 6),
  ('strawberry', 'strawberry_seeds',  90, 4, 2),
  ('tomato',     'tomato_seeds',     120, 4, 3),
  ('pumpkin',    'pumpkin_seeds',    300, 1, 4);

-- ---------------------------------------------------------------------------
-- What players own and grow
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- The vehicle you arrive in. Null: you walked, so the car park doesn't show you.
  add column vehicle        text references public.items (slug),
  -- What your avatar is doing in the garden, until activity_until.
  add column activity       text check (activity in ('smoking', 'eating')),
  add column activity_until timestamptz;

create table public.inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item    text not null references public.items (slug),
  qty     integer not null check (qty > 0),
  primary key (user_id, item)
);

-- One row per planted bed; an empty bed has no row.
create table public.plots (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  bed        smallint not null check (bed between 0 and 3),
  crop       text not null references public.crops (produce),
  planted_at timestamptz not null default now(),
  -- Study minutes credited so far. Ripe once it reaches the crop's grow_min.
  growth_min integer not null default 0,
  watered_at timestamptz,
  primary key (user_id, bed)
);

-- Offered items are taken from the sender when the offer is made (escrow) and
-- go back to them if it's declined or cancelled.
create table public.trades (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references public.profiles (id) on delete cascade,
  to_user    uuid not null references public.profiles (id) on delete cascade,
  give_item  text not null references public.items (slug),
  give_qty   integer not null check (give_qty > 0),
  -- Nothing wanted back makes it a gift.
  want_item  text references public.items (slug),
  want_qty   integer check (want_qty > 0),
  status     text not null default 'open'
             check (status in ('open', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  check (from_user <> to_user),
  check ((want_item is null) = (want_qty is null))
);

create index trades_open_to   on public.trades (to_user)   where status = 'open';
create index trades_open_from on public.trades (from_user) where status = 'open';
create index sessions_ended_by_user on public.sessions (user_id, ended_at desc)
  where status in ('completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Row level security: read-only, as in 0001.
-- ---------------------------------------------------------------------------

alter table public.items     enable row level security;
alter table public.crops     enable row level security;
alter table public.inventory enable row level security;
alter table public.plots     enable row level security;
alter table public.trades    enable row level security;

create policy "read the catalogue" on public.items
  for select to authenticated using (true);

create policy "read crop rules" on public.crops
  for select to authenticated using (true);

create policy "read own inventory" on public.inventory
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read own and friends' plots" on public.plots
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.user_id = (select auth.uid()) and f.friend_id = plots.user_id
    )
  );

create policy "read own trades" on public.trades
  for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

-- ---------------------------------------------------------------------------
-- Garden chat: Supabase Realtime Broadcast on private channels named
-- "garden:<username>". You can listen to your own channel and your friends',
-- and only speak on your own. Messages are never stored.
-- ---------------------------------------------------------------------------

create policy "garden chat: listen to yourself and friends" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.profiles p
      where 'garden:' || p.username = (select realtime.topic())
        and (
          p.id = (select auth.uid())
          or exists (
            select 1 from public.friendships f
            where f.user_id = (select auth.uid()) and f.friend_id = p.id
          )
        )
    )
  );

create policy "garden chat: speak only on your own channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and 'garden:' || p.username = (select realtime.topic())
    )
  );

-- ---------------------------------------------------------------------------
-- Internal helpers (not exposed over the API)
-- ---------------------------------------------------------------------------

-- 1 minute of break per 5 studied, at least 1: 25 -> 5, 50 -> 10, 120 -> 24.
create or replace function private.break_minutes(p_duration_min integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, round(p_duration_min / 5.0))::integer;
$$;

-- Where someone is right now, from their sessions and when they last went home:
--   focused   a session is running
--   on_break  finished a session less than its earned break ago
--   idle      up to 10 minutes after that break (or a cancelled session) ended
--   absent    otherwise, or they went home since
-- Call private.finalize_expired first so a finished timer isn't read as running.
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
  v_went_home timestamptz;
  v_free_at   timestamptz;
begin
  select s.started_at + make_interval(mins => s.duration_min) into v_ends_at
  from public.sessions s
  where s.user_id = p_user_id and s.status = 'active';

  if v_ends_at > now() then
    return query select 'focused'::text, v_ends_at, null::timestamptz;
    return;
  end if;

  select s.status, s.ended_at, s.duration_min into v_last
  from public.sessions s
  where s.user_id = p_user_id and s.status in ('completed', 'cancelled')
  order by s.ended_at desc
  limit 1;

  if not found then
    return query select 'absent'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select p.went_home_at into v_went_home from public.profiles p where p.id = p_user_id;

  -- A completed session earns a break; a cancelled one frees you straight away.
  v_free_at := case
    when v_last.status = 'completed'
      then v_last.ended_at + make_interval(mins => private.break_minutes(v_last.duration_min))
    else v_last.ended_at
  end;

  return query select
    case
      when v_went_home >= v_last.ended_at then 'absent'
      when v_last.status = 'completed' and now() < v_free_at then 'on_break'
      when now() < v_free_at + interval '10 minutes' then 'idle'
      else 'absent'
    end,
    null::timestamptz,
    case when v_last.status = 'completed' then v_free_at end;
end;
$$;

create or replace function private.status_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status from private.presence(p_user_id);
$$;

create or replace function private.require_on_break(p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.status_of(p_user_id) <> 'on_break' then
    raise exception 'That can only be done in the garden, on a break';
  end if;
end;
$$;

create or replace function private.require_not_studying(p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.status_of(p_user_id) = 'focused' then
    raise exception 'Not while you''re studying';
  end if;
end;
$$;

create or replace function private.add_item(p_user_id uuid, p_item text, p_qty integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.inventory as i (user_id, item, qty)
  values (p_user_id, p_item, p_qty)
  on conflict (user_id, item) do update set qty = i.qty + excluded.qty;
$$;

create or replace function private.take_item(p_user_id uuid, p_item text, p_qty integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_have integer;
begin
  select qty into v_have
  from public.inventory
  where user_id = p_user_id and item = p_item
  for update;

  if coalesce(v_have, 0) < p_qty then
    raise exception 'Not enough %', lower((select name from public.items where slug = p_item));
  end if;

  if v_have = p_qty then
    delete from public.inventory where user_id = p_user_id and item = p_item;
  else
    update public.inventory set qty = qty - p_qty where user_id = p_user_id and item = p_item;
  end if;
end;
$$;

-- Produce, seeds and cigarettes change hands; vehicles and desk items don't.
create or replace function private.is_tradeable(p_item text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.items where slug = p_item and kind in ('produce', 'seed', 'cigarette')
  );
$$;

create or replace function private.inventory_of(p_user_id uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_object_agg(i.item, i.qty), '{}'::json)
  from public.inventory i
  where i.user_id = p_user_id;
$$;

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
    'ripe',       b.growth_min >= c.grow_min,
    'watered',    coalesce(b.watered_at > now() - interval '24 hours', false),
    'planted_at', b.planted_at
  ) order by b.bed), '[]'::json)
  from public.plots b
  join public.crops c on c.produce = b.crop
  where b.user_id = p_user_id;
$$;

-- Lazily completes expired sessions for the given users: 1 chip per minute,
-- and every bed watered within 24 hours of the end (and planted before the
-- start) grows by the minutes studied. The row lock plus the status re-check
-- means a session is only ever completed once, even with concurrent callers.
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
    returning s.user_id, s.started_at, s.ended_at, s.duration_min
  ),
  paid as (
    update public.profiles p
       set chips = p.chips + t.mins
      from (select user_id, sum(duration_min)::integer as mins from done group by user_id) t
     where p.id = t.user_id
  )
  update public.plots b
     set growth_min = least(c.grow_min, b.growth_min + g.mins)
    from (
      select pl.user_id, pl.bed, sum(d.duration_min)::integer as mins
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
    'id',             p.id,
    'username',       p.username,
    'display_name',   p.display_name,
    'chips',          p.chips,
    'status',         pr.status,
    'break_ends_at',  pr.break_ends_at,
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
        'break_min',    private.break_minutes(s.duration_min)
      )
      from public.sessions s
      where s.user_id = v_uid and s.status = 'completed'
      order by s.ended_at desc
      limit 1
    ),
    'inventory',      private.inventory_of(v_uid),
    -- Lets the client correct for its own clock being off.
    'server_now',     now()
  )
  into v_result
  from public.profiles p
  cross join lateral private.presence(p.id) pr
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
        pr.status,
        pr.ends_at,
        pr.break_ends_at,
        p.vehicle,
        (
          select coalesce(json_agg(i.item order by it.sort), '[]'::json)
          from public.inventory i
          join public.items it on it.slug = i.item
          where i.user_id = p.id and it.kind = 'desk'
        ) as desk,
        case when p.activity_until > now() then p.activity end as activity
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_friends)
    ) b
  );
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
  -- Sitting down at your desk ends whatever you were doing in the garden.
  update public.profiles set activity = null, activity_until = null where id = v_uid;

  return public.get_me();
end;
$$;

-- Replaced by go_home(), which also works between sessions.
drop function public.leave();

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
     set went_home_at = now(), activity = null, activity_until = null
   where id = v_uid;

  return public.get_me();
end;
$$;

-- The kiosk ----------------------------------------------------------------

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
        'slug',      it.slug,
        'kind',      it.kind,
        'name',      it.name,
        'price',     it.price,
        'pack_size', it.pack_size,
        'owned',     coalesce(inv.qty, 0),
        'grow_min',  c.grow_min,
        'yield',     c.yield
      ) order by array_position(array['vehicle', 'desk', 'seed', 'cigarette'], it.kind), it.sort), '[]'::json)
      from public.items it
      left join public.inventory inv on inv.user_id = v_uid and inv.item = it.slug
      left join public.crops c on c.seed = it.slug
      where it.price is not null
    )
  );
end;
$$;

create or replace function public.buy(p_item text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_item public.items;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);
  -- One purchase at a time per player, so the "already own it" check holds.
  perform 1 from public.profiles where id = v_uid for update;

  select * into v_item from public.items where slug = p_item and price is not null;
  if not found then
    raise exception 'That isn''t for sale';
  end if;

  if v_item.kind in ('vehicle', 'desk') and exists (
    select 1 from public.inventory where user_id = v_uid and item = v_item.slug
  ) then
    raise exception 'You already have the %', lower(v_item.name);
  end if;

  update public.profiles set chips = chips - v_item.price
   where id = v_uid and chips >= v_item.price;
  if not found then
    raise exception 'Not enough chips';
  end if;

  perform private.add_item(v_uid, v_item.slug, v_item.pack_size);
  if v_item.kind = 'vehicle' then
    update public.profiles set vehicle = v_item.slug where id = v_uid;
  end if;

  return public.get_shop();
end;
$$;

-- The garden ---------------------------------------------------------------

create or replace function public.get_garden()
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

  perform private.finalize_expired(v_friends || v_uid);

  return json_build_object(
    'me', (
      select json_build_object(
        'username',       p.username,
        'display_name',   p.display_name,
        'status',         pr.status,
        'break_ends_at',  pr.break_ends_at,
        'activity',       case when p.activity_until > now() then p.activity end,
        'activity_until', case when p.activity_until > now() then p.activity_until end,
        'inventory',      private.inventory_of(p.id),
        'plots',          private.plots_of(p.id)
      )
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = v_uid
    ),
    'neighbours', (
      select coalesce(json_agg(json_build_object(
        'username',       p.username,
        'display_name',   p.display_name,
        'status',         pr.status,
        'break_ends_at',  pr.break_ends_at,
        'activity',       case when p.activity_until > now() then p.activity end,
        'activity_until', case when p.activity_until > now() then p.activity_until end,
        'plots',          private.plots_of(p.id)
      ) order by p.display_name), '[]'::json)
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_friends)
    ),
    'trades', (
      select coalesce(json_agg(json_build_object(
        'id',         t.id,
        'from',       pf.username,
        'to',         pt.username,
        'incoming',   t.to_user = v_uid,
        'give_item',  t.give_item,
        'give_qty',   t.give_qty,
        'want_item',  t.want_item,
        'want_qty',   t.want_qty,
        'created_at', t.created_at
      ) order by t.created_at), '[]'::json)
      from public.trades t
      join public.profiles pf on pf.id = t.from_user
      join public.profiles pt on pt.id = t.to_user
      where t.status = 'open' and v_uid in (t.from_user, t.to_user)
    ),
    'server_now', now()
  );
end;
$$;

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
  -- Seeds are watered in when they're planted.
  insert into public.plots (user_id, bed, crop, watered_at) values (v_uid, p_bed, v_crop, now());

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

  update public.plots set watered_at = now() where user_id = v_uid;

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
  v_uid   uuid := private.require_uid();
  v_crop  text;
  v_yield integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

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

-- Cosmetic for now: your friends see you having a snack.
create or replace function public.eat(p_item text)
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

  if not exists (select 1 from public.items where slug = p_item and kind = 'produce') then
    raise exception 'You can''t eat that';
  end if;

  perform private.take_item(v_uid, p_item, 1);
  update public.profiles
     set activity = 'eating', activity_until = now() + interval '1 minute'
   where id = v_uid;

  return public.get_garden();
end;
$$;

create or replace function public.save_seeds(p_item text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_seed  text;
  v_count integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select seed, seeds_per into v_seed, v_count from public.crops where produce = p_item;
  if v_seed is null then
    raise exception 'There are no seeds to save from that';
  end if;

  perform private.take_item(v_uid, p_item, 1);
  perform private.add_item(v_uid, v_seed, v_count);

  return public.get_garden();
end;
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
     set activity = 'smoking', activity_until = now() + interval '5 minutes'
   where id = v_uid;

  return public.get_garden();
end;
$$;

-- Trades -------------------------------------------------------------------

-- Pass null (or 0) for p_want / p_want_qty to make it a gift.
create or replace function public.offer_trade(
  p_to       text,
  p_give     text,
  p_give_qty integer,
  p_want     text,
  p_want_qty integer
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := private.require_uid();
  v_to       uuid;
  v_want     text := p_want;
  v_want_qty integer := p_want_qty;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select f.friend_id into v_to
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid and p.username = lower(trim(p_to));

  if v_to is null then
    raise exception 'You can only trade with friends';
  end if;

  if not private.is_tradeable(p_give) then
    raise exception 'You can''t trade that';
  end if;
  if p_give_qty is null or p_give_qty < 1 then
    raise exception 'Offer at least one';
  end if;

  if v_want is null or coalesce(v_want_qty, 0) = 0 then
    v_want := null;
    v_want_qty := null;
  elsif not private.is_tradeable(v_want) or v_want_qty < 1 then
    raise exception 'You can''t ask for that';
  end if;

  if (select count(*) from public.trades where from_user = v_uid and status = 'open') >= 10 then
    raise exception 'You already have 10 offers waiting';
  end if;

  perform private.take_item(v_uid, p_give, p_give_qty);
  insert into public.trades (from_user, to_user, give_item, give_qty, want_item, want_qty)
  values (v_uid, v_to, p_give, p_give_qty, v_want, v_want_qty);

  return public.get_garden();
end;
$$;

create or replace function public.respond_trade(p_id bigint, p_accept boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_trade public.trades;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select * into v_trade
  from public.trades
  where id = p_id and to_user = v_uid and status = 'open'
  for update;

  if not found then
    raise exception 'That offer is no longer open';
  end if;

  if p_accept then
    if v_trade.want_item is not null then
      perform private.take_item(v_uid, v_trade.want_item, v_trade.want_qty);
      perform private.add_item(v_trade.from_user, v_trade.want_item, v_trade.want_qty);
    end if;
    perform private.add_item(v_uid, v_trade.give_item, v_trade.give_qty);
    update public.trades set status = 'accepted', closed_at = now() where id = p_id;
  else
    perform private.add_item(v_trade.from_user, v_trade.give_item, v_trade.give_qty);
    update public.trades set status = 'declined', closed_at = now() where id = p_id;
  end if;

  return public.get_garden();
end;
$$;

-- Withdrawing an offer works any time, so nothing is ever stuck in escrow.
create or replace function public.cancel_trade(p_id bigint)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_trade public.trades;
begin
  select * into v_trade
  from public.trades
  where id = p_id and from_user = v_uid and status = 'open'
  for update;

  if not found then
    raise exception 'That offer is no longer open';
  end if;

  perform private.add_item(v_uid, v_trade.give_item, v_trade.give_qty);
  update public.trades set status = 'cancelled', closed_at = now() where id = p_id;

  return public.get_garden();
end;
$$;

-- Only signed-in users may call the API.
revoke execute on function
  public.go_home(),
  public.get_shop(),
  public.buy(text),
  public.get_garden(),
  public.plant(integer, text),
  public.water(),
  public.harvest(integer),
  public.eat(text),
  public.save_seeds(text),
  public.smoke(),
  public.offer_trade(text, text, integer, text, integer),
  public.respond_trade(bigint, boolean),
  public.cancel_trade(bigint)
from public, anon;

grant execute on function
  public.go_home(),
  public.get_shop(),
  public.buy(text),
  public.get_garden(),
  public.plant(integer, text),
  public.water(),
  public.harvest(integer),
  public.eat(text),
  public.save_seeds(text),
  public.smoke(),
  public.offer_trade(text, text, integer, text, integer),
  public.respond_trade(bigint, boolean),
  public.cancel_trade(bigint)
to authenticated;
