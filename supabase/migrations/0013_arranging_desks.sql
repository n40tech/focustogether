-- Focus, part 13: arranging your desk.
--   * desk_layout: where each of your desk things sits on your desk, in desk
--     units from the desk's front-centre. A thing you own with no row is in
--     the drawer.
--   * everyone's desk things stay where they were: the eight spots the app
--     used to put them in, in shop order. Something new starts in the
--     drawer, and the app has you drag it onto your desk.
--   * place_desk_item and store_desk_item, between sessions only
--   * desk_items (get_me, get_friends_board, get_friends_of_friends) is now
--     [{item, x, y}] for the things on the desk, back to front
-- Run after 0012_looks.sql.

create table public.desk_layout (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item    text not null references public.items (slug),
  x       real not null check (x between -42 and 42),
  y       real not null check (y between -44 and -12),
  primary key (user_id, item)
);

alter table public.desk_layout enable row level security;

create policy "read your own and friends' desks" on public.desk_layout
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.user_id = (select auth.uid()) and f.friend_id = desk_layout.user_id
    )
  );

-- Everyone's desk things where they were: the eight spots src/art/Office.tsx
-- put them in, in shop order.
insert into public.desk_layout (user_id, item, x, y)
select o.user_id, o.item, s.x, s.y
from (
  select i.user_id, i.item, row_number() over (partition by i.user_id order by it.sort) as n
  from public.inventory i
  join public.items it on it.slug = i.item
  where it.kind = 'desk' and i.qty > 0
) o
join (values
  (1, -36::real, -24::real), (2, 36, -26), (3, -40, -38), (4, 40, -38),
  (5, -24, -16), (6, 24, -16), (7, -30, -44), (8, 30, -44)
) s (n, x, y) on s.n = o.n;

-- What's on someone's desk, back to front, so nearer things are drawn over further ones.
create or replace function private.desk_items_of(p_user uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object('item', l.item, 'x', l.x, 'y', l.y)
                           order by l.y, l.x), '[]'::json)
  from public.desk_layout l
  where l.user_id = p_user;
$$;

-- Puts one of your desk things at (x, y) on your desk (kept to the desk
-- top), from the drawer or from somewhere else on the desk.
create or replace function public.place_desk_item(p_item text, p_x real, p_y real)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);
  if not exists (
    select 1 from public.inventory i
    join public.items it on it.slug = i.item
    where i.user_id = v_uid and i.item = p_item and it.kind = 'desk' and i.qty > 0
  ) then
    raise exception 'You haven''t got that for your desk';
  end if;
  if p_x is null or p_y is null or p_x = 'NaN' or p_y = 'NaN' then
    raise exception 'Somewhere on the desk, please';
  end if;

  insert into public.desk_layout (user_id, item, x, y)
  values (v_uid, p_item, greatest(-42, least(42, p_x)), greatest(-44, least(-12, p_y)))
  on conflict (user_id, item) do update set x = excluded.x, y = excluded.y;
  return public.get_me();
end;
$$;

-- Puts one of your desk things away in the drawer.
create or replace function public.store_desk_item(p_item text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);
  delete from public.desk_layout where user_id = v_uid and item = p_item;
  return public.get_me();
end;
$$;

-- As in 0010, plus desk_items.
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

-- As in 0006, with desk things where they sit.
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
        private.desk_items_of(p.id) as desk_items,
        case when p.activity_until > now() then p.activity end as activity
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_friends)
    ) b
  );
end;
$$;

-- As in 0011, with desk things where they sit.
create or replace function public.get_friends_of_friends()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_others uuid[] := private.friends_of_friends(v_uid);
begin
  perform private.finalize_expired(v_others);

  return (
    select coalesce(json_agg(row_to_json(b) order by b.display_name), '[]'::json)
    from (
      select
        p.username,
        p.display_name,
        pr.status,
        p.desk,
        case when pr.status = 'focused' then 'office' else p.place end as place,
        p.arrived_at,
        p.vehicle,
        private.desk_items_of(p.id) as desk_items,
        private.friends_in_common(v_uid, p.id) as via
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_others) and pr.status <> 'absent'
    ) b
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.place_desk_item(text, real, real),
  public.store_desk_item(text)
from public, anon;

grant execute on function
  public.place_desk_item(text, real, real),
  public.store_desk_item(text)
to authenticated;
