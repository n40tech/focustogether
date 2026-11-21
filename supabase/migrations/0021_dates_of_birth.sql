-- Focus, part 21: dates of birth.
--   * Signing up takes a date of birth (public.birthdays). Nobody can read it,
--     not even its owner: the app only hears whether you're under 18
--     (get_me's under_18).
--   * Under-18s have no cigarettes. The shed doesn't show or sell them, they
--     can't smoke, and none can come to them from a friend's trade or stall
--     (private.add_item refuses). On their 18th birthday that stops.
--   * Players who joined before have no date of birth, and count as grown-ups.
-- Run after 0020_website_invites.sql.

create table public.birthdays (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  born    date not null check (born >= date '1900-01-01')
);
-- No policies: only the functions below read it.
alter table public.birthdays enable row level security;
revoke all on table public.birthdays from public, anon, authenticated;

-- True while a player is under 18. Without a date of birth, they aren't.
create or replace function private.under_18(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.born > current_date - interval '18 years'
     from public.birthdays b where b.user_id = p_user_id),
    false
  );
$$;

-- As in 0002, but cigarettes never go to an under-18.
create or replace function private.add_item(p_user_id uuid, p_item text, p_qty integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.under_18(p_user_id)
     and exists (select 1 from public.items where slug = p_item and kind = 'cigarette') then
    raise exception 'Cigarettes are only for over-18s';
  end if;
  insert into public.inventory as i (user_id, item, qty)
  values (p_user_id, p_item, p_qty)
  on conflict (user_id, item) do update set qty = i.qty + excluded.qty;
end;
$$;

-- As in 0017, plus a date of birth, kept in public.birthdays.
create or replace function private.on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite', ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := private.normal_username(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_name     text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_email    text := private.normal_email(new.raw_user_meta_data ->> 'contact_email');
  v_born     date;
  v_invite   public.invites;
begin
  begin
    v_born := to_date(new.raw_user_meta_data ->> 'born', 'YYYY-MM-DD');
    if v_born::text is distinct from new.raw_user_meta_data ->> 'born' then
      v_born := null;
    end if;
  exception when others then
    v_born := null;
  end;

  select * into v_invite from public.invites where code = v_code for update;
  if not found or v_invite.used_by is not null or v_invite.expires_at < now() then
    raise exception 'Focus is invite-only, and that invite code isn''t valid';
  end if;
  if not private.is_username(v_username) then
    raise exception 'Usernames are 3 to 20 letters, numbers or _';
  end if;
  if new.email is distinct from private.username_key(v_username) || '@focus.test' then
    raise exception 'The account email must be <plain username>@focus.test';
  end if;
  if not private.is_email(v_email) then
    raise exception 'Sign-up needs a real email address';
  end if;
  if v_born is null or v_born < date '1900-01-01' or v_born > current_date then
    raise exception 'Sign-up needs a real date of birth';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, coalesce(v_name, v_username));
  insert into public.emails (user_id, email) values (new.id, v_email);
  insert into public.birthdays (user_id, born) values (new.id, v_born);

  update public.invites set used_by = new.id, used_at = now() where code = v_code;

  if v_invite.created_by is not null then
    perform private.befriend(new.id, v_invite.created_by);
  end if;
  return new;
end;
$$;

-- As in 0017, but under-18s don't see cigarettes.
create or replace function public.get_shop()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return (
    select json_build_object(
      'chips',           p.chips,
      'vehicle',         p.vehicle,
      'vehicle_health',  p.vehicle_health,
      'repair_cost',     private.repair_cost(p.vehicle, 100 - p.vehicle_health),
      'insured_until',   case when p.insured_until > now() then p.insured_until end,
      'insurance_price', private.insurance_price(),
      'insurance_days',  extract(day from private.insurance_lasts())::integer,
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
          and not (it.kind = 'cigarette' and private.under_18(v_uid))
      )
    )
    from public.profiles p
    where p.id = v_uid
  );
end;
$$;

-- As in 0017, but not for under-18s.
create or replace function public.smoke()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_status text;
begin
  if private.under_18(v_uid) then
    raise exception 'Cigarettes are only for over-18s';
  end if;

  perform private.finalize_expired(array[v_uid]);
  v_status := private.status_of(v_uid);
  if v_status = 'focused' then
    raise exception 'Not while you''re studying';
  end if;
  if v_status = 'absent' then
    raise exception 'Park up or walk about first';
  end if;

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

-- As in 0017, plus whether you're under 18.
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
    'vehicle_health', p.vehicle_health,
    'parked',         case when pr.status <> 'absent' then p.parked end,
    'insured_until',  case when p.insured_until > now() then p.insured_until end,
    'crashes',        private.crashes_of(v_uid),
    'activity',       case when p.activity_until > now() then p.activity end,
    'activity_until', case when p.activity_until > now() then p.activity_until end,
    'hard_mode',      p.hard_mode,
    'email',          (select e.email from public.emails e where e.user_id = v_uid),
    'under_18',       private.under_18(v_uid),
    'active_session', (
      select json_build_object(
        'id',           s.id,
        'started_at',   s.started_at,
        'duration_min', s.duration_min,
        'ends_at',      s.started_at + make_interval(mins => s.duration_min),
        'device',       s.device,
        'hard',         s.hard
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
    'streak',         private.streak(v_uid),
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
