-- Focus, part 3: community.
--   * desks are handed out at random as people arrive, and kept until they go home
--   * every allotment has a fixed place in one shared garden grid
--   * a market: friends sell from stalls in the garden and buy from each other
--   * sign-up is invite-only
--   * payouts are about 1 chip a minute, give or take a little luck
--   * you can water a friend's plot (but not harvest it)
--   * eating a crop is just a snack: no status for friends to see
-- Run after 0002_game.sql: SQL Editor -> New query -> paste this file -> Run.

-- ---------------------------------------------------------------------------
-- New columns and tables
-- ---------------------------------------------------------------------------

-- What a completed session paid out (null for sessions before this migration).
alter table public.sessions add column chips integer;

alter table public.profiles
  -- When you last walked into the office.
  add column arrived_at timestamptz,
  -- Your desk (0-11) while you're at work. Handed out at random on arrival.
  add column desk smallint check (desk between 0 and 11),
  -- Where your allotment sits in the garden grid, for good.
  add column plot_slot smallint unique check (plot_slot >= 0);

-- Existing players get garden slots in the order they joined.
with ordered as (
  select p.id, (row_number() over (order by u.created_at, p.username) - 1)::smallint as slot
  from public.profiles p
  join auth.users u on u.id = p.id
)
update public.profiles p set plot_slot = o.slot from ordered o where o.id = p.id;

-- Items friends have set out on their market stall, at a price per item. Like
-- trade offers, they're taken from the seller's basket until sold or taken back.
create table public.listings (
  id         bigint generated always as identity primary key,
  seller     uuid not null references public.profiles (id) on delete cascade,
  item       text not null references public.items (slug),
  qty        integer not null check (qty > 0),
  price      integer not null check (price between 1 and 999),
  created_at timestamptz not null default now(),
  unique (seller, item, price)
);

create table public.invites (
  code       text primary key check (code ~ '^[A-Z0-9]{4,16}$'),
  -- Null for invites made by hand in the SQL editor.
  created_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by    uuid references public.profiles (id) on delete set null,
  used_at    timestamptz
);

alter table public.listings enable row level security;
alter table public.invites  enable row level security;

create policy "read own and friends' stalls" on public.listings
  for select to authenticated
  using (
    seller = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.user_id = (select auth.uid()) and f.friend_id = listings.seller
    )
  );

create policy "read invites you made" on public.invites
  for select to authenticated
  using (created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Where people are: arriving at the office now counts as being at work.
-- ---------------------------------------------------------------------------

-- Same statuses as before, plus arrival:
--   focused   a session is running
--   on_break  finished a session less than its earned break ago
--   idle      at work but neither: up to 15 minutes after arriving, or after
--             a break (or a given-up session) ends
--   absent    otherwise, or they went home since
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

  select p.went_home_at, p.arrived_at into v_profile from public.profiles p where p.id = p_user_id;

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
      else 'absent'
    end,
    null::timestamptz,
    case when v_last.status = 'completed' then v_free_at end;
end;
$$;

-- Hands you a desk if you're not already at work: a random one that none of
-- your friends at work is using (any desk, if all twelve are taken).
create or replace function private.arrive(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_friends uuid[];
  v_desk    smallint;
begin
  select coalesce(array_agg(friend_id), '{}') into v_friends
  from public.friendships where user_id = p_user_id;

  perform private.finalize_expired(v_friends || p_user_id);

  if private.status_of(p_user_id) <> 'absent' then
    return;
  end if;

  select d into v_desk
  from generate_series(0, 11) d
  where not exists (
    select 1 from public.profiles p
    where p.id = any (v_friends)
      and p.desk = d
      and private.status_of(p.id) <> 'absent'
  )
  order by random()
  limit 1;

  update public.profiles
     set arrived_at = now(),
         desk = coalesce(v_desk, floor(random() * 12)::smallint)
   where id = p_user_id;
end;
$$;

-- Your desk while you're at work, else null.
create or replace function private.desk_of(p_user_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.status_of(p_user_id) <> 'absent' then p.desk end
  from public.profiles p
  where p.id = p_user_id;
$$;

-- New players take the lowest free garden slot.
create or replace function private.assign_plot_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plot_slot is null then
    perform pg_advisory_xact_lock(hashtext('focus.plot_slot'));
    select min(s)::smallint into new.plot_slot
    from generate_series(0, 10000) s
    where not exists (select 1 from public.profiles p where p.plot_slot = s);
  end if;
  return new;
end;
$$;

create trigger assign_plot_slot
  before insert on public.profiles
  for each row execute function private.assign_plot_slot();

create or replace function private.stall_of(p_user_id uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'id', l.id, 'item', l.item, 'qty', l.qty, 'price', l.price
  ) order by l.item, l.price), '[]'::json)
  from public.listings l
  where l.seller = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Luck: about 1 chip a minute, give or take up to 12%, usually less.
-- ---------------------------------------------------------------------------

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
-- Invite-only sign-up
-- ---------------------------------------------------------------------------

-- 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), drawn
-- from gen_random_uuid's strong randomness (skipping its fixed version bytes).
create or replace function private.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + get_byte(b, k) % 31, 1), '' order by k
  )
  from (select uuid_send(gen_random_uuid()) as b) r,
       unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) k;
$$;

-- Makes an invite and returns its code. In the SQL editor, run
--   select private.make_invite();
-- to invite someone without an account of your own.
create or replace function private.make_invite(p_from uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := private.new_invite_code();
    begin
      insert into public.invites (code, created_by) values (v_code, p_from);
      return v_code;
    exception when unique_violation then
      -- Astronomically unlikely; try another.
    end;
  end loop;
end;
$$;

-- Runs for every new account. Without a valid invite the sign-up fails, so
-- accounts can only be made through the app with an invite code (making one
-- in the dashboard fails too). The invitee gets their profile and becomes
-- friends with whoever invited them.
create or replace function private.on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite', ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_name     text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_invite   public.invites;
begin
  select * into v_invite from public.invites where code = v_code for update;
  if not found or v_invite.used_by is not null or v_invite.expires_at < now() then
    raise exception 'Focus is invite-only, and that invite code isn''t valid';
  end if;
  if new.email is distinct from v_username || '@focus.test' then
    raise exception 'The account email must be <username>@focus.test';
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

create trigger focus_invite_only_signup
  after insert on auth.users
  for each row execute function private.on_signup();

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

-- Walk into the office: you get a desk, kept until you go home.
create or replace function public.arrive()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.arrive(v_uid);
  return public.get_me();
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
  update public.profiles set activity = null, activity_until = null where id = v_uid;

  return public.get_me();
end;
$$;

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
        'chips',          p.chips,
        'status',         pr.status,
        'break_ends_at',  pr.break_ends_at,
        'activity',       case when p.activity_until > now() then p.activity end,
        'activity_until', case when p.activity_until > now() then p.activity_until end,
        'plot_slot',      p.plot_slot,
        'inventory',      private.inventory_of(p.id),
        'plots',          private.plots_of(p.id),
        'stall',          private.stall_of(p.id)
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
        'plot_slot',      p.plot_slot,
        'plots',          private.plots_of(p.id),
        'stall',          private.stall_of(p.id)
      ) order by p.plot_slot), '[]'::json)
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

-- Eating is just a snack now: the crop is gone, nothing else changes.
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
  return public.get_garden();
end;
$$;

-- Water a friend's beds (you can't harvest them, though).
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

  update public.plots set watered_at = now() where user_id = v_friend;
  return public.get_garden();
end;
$$;

-- The market --------------------------------------------------------------

-- Sets items out on your stall at `p_price` chips each.
create or replace function public.list_item(p_item text, p_qty integer, p_price integer)
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
    raise exception 'You can''t sell that';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'Put out at least one';
  end if;
  if p_price is null or p_price not between 1 and 999 then
    raise exception 'Prices are 1 to 999 chips each';
  end if;
  if (select count(*) from public.listings where seller = v_uid) >= 12
     and not exists (select 1 from public.listings where seller = v_uid and item = p_item and price = p_price) then
    raise exception 'Your stall is full (12 things at most)';
  end if;

  perform private.take_item(v_uid, p_item, p_qty);
  insert into public.listings as l (seller, item, qty, price)
  values (v_uid, p_item, p_qty, p_price)
  on conflict (seller, item, price) do update set qty = l.qty + excluded.qty;

  return public.get_garden();
end;
$$;

-- Takes something back off your stall. Works any time, like withdrawing an offer.
create or replace function public.unlist(p_id bigint)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = p_id and seller = v_uid for update;
  if not found then
    raise exception 'That''s no longer on your stall';
  end if;

  perform private.add_item(v_uid, v_listing.item, v_listing.qty);
  delete from public.listings where id = p_id;

  return public.get_garden();
end;
$$;

-- Buys from a friend's stall. You both have to be in the garden (on a break);
-- the app only offers it when you're standing next to them.
create or replace function public.buy_listing(p_id bigint, p_qty integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_listing public.listings;
  v_cost    integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_on_break(v_uid);

  select * into v_listing from public.listings where id = p_id for update;
  if not found then
    raise exception 'That''s sold out';
  end if;
  if v_listing.seller = v_uid then
    raise exception 'That''s your own stall';
  end if;
  if not exists (
    select 1 from public.friendships where user_id = v_uid and friend_id = v_listing.seller
  ) then
    raise exception 'You can only buy from friends';
  end if;

  perform private.finalize_expired(array[v_listing.seller]);
  if private.status_of(v_listing.seller) <> 'on_break' then
    raise exception 'Their stall is closed while they''re not in the garden';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > v_listing.qty then
    raise exception 'There aren''t that many';
  end if;

  v_cost := p_qty * v_listing.price;
  -- Lock both purses in a fixed order so two people buying from each other can't deadlock.
  perform 1 from public.profiles where id in (v_uid, v_listing.seller) order by id for update;

  update public.profiles set chips = chips - v_cost where id = v_uid and chips >= v_cost;
  if not found then
    raise exception 'Not enough chips';
  end if;
  update public.profiles set chips = chips + v_cost where id = v_listing.seller;
  perform private.add_item(v_uid, v_listing.item, p_qty);

  if p_qty = v_listing.qty then
    delete from public.listings where id = p_id;
  else
    update public.listings set qty = qty - p_qty where id = p_id;
  end if;

  return public.get_garden();
end;
$$;

-- Invites ------------------------------------------------------------------

-- Up to 5 unused invites at a time; each lasts 14 days and works once.
create or replace function public.create_invite()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_code text;
begin
  if (
    select count(*) from public.invites
    where created_by = v_uid and used_by is null and expires_at > now()
  ) >= 5 then
    raise exception 'You already have 5 unused invites';
  end if;

  v_code := private.make_invite(v_uid);
  return (select json_build_object('code', code, 'expires_at', expires_at) from public.invites where code = v_code);
end;
$$;

create or replace function public.get_invites()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return (
    select coalesce(json_agg(json_build_object(
      'code',       i.code,
      'expires_at', i.expires_at,
      'used_by',    p.display_name,
      'used_at',    i.used_at
    ) order by i.created_at desc), '[]'::json)
    from (
      select * from public.invites
      where created_by = v_uid and (used_by is not null or expires_at > now())
      order by created_at desc
      limit 20
    ) i
    left join public.profiles p on p.id = i.used_by
  );
end;
$$;

-- Lets the sign-up form check an invite and a username before creating the
-- account, so people get a clear reason instead of a generic error.
create or replace function public.check_signup(p_code text, p_username text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_from     text;
begin
  select coalesce(p.display_name, 'Focus') into v_from
  from public.invites i
  left join public.profiles p on p.id = i.created_by
  where i.code = v_code and i.used_by is null and i.expires_at > now();

  if v_from is null then
    return json_build_object('ok', false, 'reason', 'That invite code isn''t valid, or it''s been used');
  end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    return json_build_object('ok', false, 'from', v_from,
      'reason', 'Usernames are 3 to 20 lowercase letters, numbers or _');
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    return json_build_object('ok', false, 'from', v_from, 'reason', 'That username is taken');
  end if;
  return json_build_object('ok', true, 'from', v_from);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.arrive(),
  public.water_friend(text),
  public.list_item(text, integer, integer),
  public.unlist(bigint),
  public.buy_listing(bigint, integer),
  public.create_invite(),
  public.get_invites(),
  public.check_signup(text, text)
from public, anon;

grant execute on function
  public.arrive(),
  public.water_friend(text),
  public.list_item(text, integer, integer),
  public.unlist(bigint),
  public.buy_listing(bigint, integer),
  public.create_invite(),
  public.get_invites()
to authenticated;

-- The sign-up form runs before there's an account.
grant execute on function public.check_signup(text, text) to anon, authenticated;
