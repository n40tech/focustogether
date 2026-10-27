-- Focus, part 17: hard mode, emails, driving, and study invites.
--   * Leaving the page no longer stops a session, unless you've turned on hard
--     mode (profiles.hard_mode). Each session keeps the mode it started in
--     (sessions.hard), and leave_page and back_to_page only act on hard ones.
--   * Signing up takes a real email address (public.emails), for news of
--     Focus Together. Only its owner can read it (and the dashboard).
--     Players who joined before can add one.
--   * The car park: you drive your vehicle in and park it where you like
--     (profiles.parked), which counts as arriving. Driving into a friend's
--     parked vehicle damages both (profiles.vehicle_health, 0 to 100), and
--     they can claim damages from you (public.crashes), which you pay unless
--     you're insured (profiles.insured_until). The shed repairs vehicles and
--     sells insurance. You can walk about there and smoke, and friends hear
--     where you are on "carpark:" channels, as in the garden.
--   * An invite can be to the session you're studying: whoever opens it
--     (signing up first if they need to) becomes your friend and studies with
--     you until you finish. Signed-in players can use any invite to become
--     friends with whoever made it.
-- Run after 0016_streaks.sql.

-- ---------------------------------------------------------------------------
-- Hard mode
-- ---------------------------------------------------------------------------

alter table public.profiles add column hard_mode boolean not null default false;
-- Sessions started before this were strict, but they're over within two hours.
alter table public.sessions add column hard boolean not null default false;

create or replace function public.set_hard_mode(p_on boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.profiles set hard_mode = coalesce(p_on, false) where id = v_uid;
  return public.get_me();
end;
$$;

-- As in 0007, plus the mode you've chosen.
create or replace function public.start_session(p_minutes integer, p_device text default null)
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
  insert into public.sessions (user_id, duration_min, device, hard)
  select v_uid, p_minutes, left(p_device, 64), p.hard_mode
  from public.profiles p where p.id = v_uid;
  -- Sitting down at your desk ends whatever you were doing in the garden.
  update public.profiles
     set activity = null, activity_until = null, place = 'office', seen_at = now()
   where id = v_uid;

  return public.get_me();
end;
$$;

-- As in 0010, plus the mode you've chosen (yours, not your friend's).
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
  insert into public.sessions (user_id, started_at, duration_min, device, hard)
  select v_uid, v_ends_at - make_interval(mins => v_minutes), v_minutes, left(p_device, 64),
         p.hard_mode
  from public.profiles p where p.id = v_uid;
  update public.profiles
     set activity = null, activity_until = null, place = 'office', seen_at = now()
   where id = v_uid;

  return public.get_me();
end;
$$;

-- As in 0007, but only a session in hard mode minds being left.
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
     and hard
     and device is not distinct from p_device;
end;
$$;

-- As in 0007, but only a session in hard mode can be taken back.
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
       and hard
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
            and hard
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
-- Emails
-- ---------------------------------------------------------------------------

-- An address that could really be written to: one @, a domain with a dot, and
-- none of the names kept for tests and examples. Stored in lower case.
create or replace function private.is_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    length(p_email) between 6 and 254
    and p_email ~ '^[a-z0-9!#%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'
    and split_part(p_email, '@', 2) !~ '(^|\.)(test|example|invalid|localhost|local)$'
    and split_part(p_email, '@', 2) not in ('example.com', 'example.org', 'example.net'),
    false
  );
$$;

create or replace function private.normal_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(trim(coalesce(p_email, '')));
$$;

create table public.emails (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  email    text not null check (private.is_email(email)),
  added_at timestamptz not null default now()
);
alter table public.emails enable row level security;
create policy "read your own email" on public.emails
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Adds or changes your email.
create or replace function public.set_email(p_email text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_email text := private.normal_email(p_email);
begin
  if not private.is_email(v_email) then
    raise exception 'That doesn''t look like a real email address';
  end if;
  insert into public.emails (user_id, email) values (v_uid, v_email)
  on conflict (user_id) do update set email = excluded.email, added_at = now();
  return public.get_me();
end;
$$;

-- As in 0008, plus a real email, kept in public.emails.
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
  v_invite   public.invites;
begin
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

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, coalesce(v_name, v_username));
  insert into public.emails (user_id, email) values (new.id, v_email);

  update public.invites set used_by = new.id, used_at = now() where code = v_code;

  if v_invite.created_by is not null then
    perform private.befriend(new.id, v_invite.created_by);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Study invites
-- ---------------------------------------------------------------------------

-- The session an invite asks you to join, if any. Signing up with it is fine
-- after the session's over: you're still friends.
alter table public.invites add column session bigint references public.sessions (id) on delete set null;

-- When the session an invite asks you to join ends, if it's still running.
create or replace function private.invite_studying_until(p_invite public.invites)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select s.started_at + make_interval(mins => s.duration_min)
  from public.sessions s
  where s.id = p_invite.session
    and s.status = 'active'
    and s.started_at + make_interval(mins => s.duration_min) > now();
$$;

-- As in 0008, plus the email (when it's been typed), and whether the invite
-- is to a session that's still running.
drop function public.check_signup(text, text);
create function public.check_signup(p_code text, p_username text, p_email text default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_username text := private.normal_username(coalesce(p_username, ''));
  v_email    text := private.normal_email(p_email);
  v_invite   public.invites;
  v_from     text;
  v_until    timestamptz;
  v_taken    text;
begin
  select i.* into v_invite
  from public.invites i
  where i.code = v_code and i.used_by is null and i.expires_at > now();
  if found then
    v_from := coalesce(
      (select display_name from public.profiles where id = v_invite.created_by),
      'Focus'
    );
    v_until := private.invite_studying_until(v_invite);
  end if;

  if v_from is null then
    return json_build_object('ok', false, 'reason', 'That invite code isn''t valid, or it''s been used');
  end if;
  if not private.is_username(v_username) then
    return json_build_object('ok', false, 'from', v_from, 'studying_until', v_until,
      'reason', 'Usernames are 3 to 20 letters, numbers or _. Accents are fine');
  end if;
  select username into v_taken
  from public.profiles
  where private.username_key(username) = private.username_key(v_username);
  if v_taken = v_username then
    return json_build_object('ok', false, 'from', v_from, 'studying_until', v_until,
      'reason', 'That username is taken');
  end if;
  if v_taken is not null then
    return json_build_object('ok', false, 'from', v_from, 'studying_until', v_until,
      'reason', format('That''s too close to @%s, who''s already here', v_taken));
  end if;
  if v_email <> '' and not private.is_email(v_email) then
    return json_build_object('ok', false, 'from', v_from, 'studying_until', v_until,
      'reason', 'That doesn''t look like a real email address');
  end if;
  return json_build_object('ok', true, 'from', v_from, 'studying_until', v_until);
end;
$$;

-- An invite to the session you're studying: a link a friend (or someone not
-- here yet) can open to study with you until you finish.
create or replace function public.invite_to_session()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_session public.sessions;
  v_code    text;
begin
  perform private.finalize_expired(array[v_uid]);
  select * into v_session from public.sessions where user_id = v_uid and status = 'active';
  if not found then
    raise exception 'Start a session first';
  end if;
  if (
    select count(*) from public.invites
    where created_by = v_uid and used_by is null and expires_at > now()
  ) >= 5 then
    raise exception 'You already have 5 unused invites';
  end if;

  v_code := private.make_invite(v_uid);
  update public.invites set session = v_session.id where code = v_code;
  return (
    select json_build_object(
      'code',       code,
      'expires_at', expires_at,
      'ends_at',    v_session.started_at + make_interval(mins => v_session.duration_min)
    )
    from public.invites where code = v_code
  );
end;
$$;

-- Opens an invite while signed in (or straight after signing up with it):
-- you're friends with whoever made it, and if it's to a session that's still
-- running, you join it. `joined` says whether you did, and `note` why not.
create or replace function public.use_invite(p_code text, p_device text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.invites;
  v_host   public.profiles;
  v_joined boolean := false;
  v_note   text;
begin
  select * into v_invite from public.invites where code = v_code for update;
  if not found
     or (v_invite.used_by is not null and v_invite.used_by <> v_uid)
     or (v_invite.used_by is null and v_invite.expires_at < now()) then
    raise exception 'That invite isn''t valid, or it''s been used';
  end if;
  if v_invite.created_by = v_uid then
    raise exception 'That''s your own invite';
  end if;
  select * into v_host from public.profiles where id = v_invite.created_by;
  if not found then
    raise exception 'That invite is only for joining Focus Together';
  end if;

  if v_invite.used_by is null then
    update public.invites set used_by = v_uid, used_at = now() where code = v_code;
  end if;
  perform private.befriend(v_uid, v_host.id);

  if v_invite.session is not null then
    perform private.finalize_expired(array[v_host.id]);
    if private.invite_studying_until(v_invite) is null then
      v_note := format('%s has finished that session', v_host.display_name);
    elsif exists (select 1 from public.sessions where user_id = v_uid and status = 'active') then
      v_note := 'You''re studying already';
    else
      begin
        perform public.join_session(v_host.username, p_device);
        v_joined := true;
      exception when others then
        v_note := sqlerrm;
      end;
    end if;
  end if;

  return json_build_object(
    'from',     v_host.display_name,
    'username', v_host.username,
    'session',  v_invite.session is not null,
    'joined',   v_joined,
    'note',     v_note,
    'me',       public.get_me()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The car park
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Where your vehicle is parked while you're at work: {x, y, a}, in car park
  -- units, `a` its heading in radians (0 = nose up the screen).
  add column parked jsonb,
  add column vehicle_health smallint not null default 100
    check (vehicle_health between 0 and 100),
  add column insured_until timestamptz;

-- Someone drove into a friend's parked vehicle. The owner can claim damages
-- (the driver, or their insurer, pays to put it right) or let it go.
create table public.crashes (
  id         bigint generated always as identity primary key,
  driver     uuid not null references public.profiles (id) on delete cascade,
  owner      uuid not null references public.profiles (id) on delete cascade,
  vehicle    text not null references public.items (slug),
  damage     smallint not null check (damage between 1 and 100),
  -- Chips to repair the damage, as the shed charges.
  cost       integer not null check (cost >= 0),
  at         timestamptz not null default now(),
  status     text not null default 'open' check (status in ('open', 'claimed', 'waived')),
  paid_by    text check (paid_by in ('driver', 'insurer')),
  -- What the driver paid: the cost, or what they had if it was less.
  paid       integer check (paid >= 0),
  settled_at timestamptz
);
create index crashes_owner on public.crashes (owner, status);
create index crashes_driver on public.crashes (driver, at);
alter table public.crashes enable row level security;
create policy "read crashes you were in" on public.crashes
  for select to authenticated
  using ((select auth.uid()) in (driver, owner));

-- What the shed charges to repair `damage` points: half the price for a wreck.
create or replace function private.repair_cost(p_vehicle text, p_damage integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ceil(i.price * greatest(p_damage, 0) / 200.0)::integer, 0)
  from public.items i where i.slug = p_vehicle;
$$;

create or replace function private.insurance_price()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 30;
$$;

create or replace function private.insurance_lasts()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '7 days';
$$;

-- As in 0006, plus: while your app is open in the car park, you're at work too.
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
      when v_profile.place in ('office', 'garden', 'outside')
        and v_profile.seen_at > now() - interval '2 minutes' then 'idle'
      else 'absent'
    end,
    null::timestamptz,
    case when v_last.status = 'completed' then v_free_at end;
end;
$$;

-- As in 0006, plus: walking about the car park counts as arriving.
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

  if v_place in ('office', 'outside') then
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

-- As in 0006, plus: your vehicle goes home with you.
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
     set went_home_at = now(), activity = null, activity_until = null, place = null,
         parked = null
   where id = v_uid;

  return public.get_me();
end;
$$;

-- Parks your vehicle at (x, y), facing `a`. Driving in and parking is arriving.
create or replace function public.park(p_x real, p_y real, p_a real)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_profile public.profiles;
  v_turn    double precision := 2 * pi();
begin
  if p_x is null or p_y is null or p_a is null then
    raise exception 'Park somewhere in the car park';
  end if;
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.vehicle is null then
    raise exception 'You came on foot';
  end if;
  if v_profile.vehicle_health = 0 then
    raise exception 'Your % is a wreck. The shed can repair it.',
      (select lower(name) from public.items where slug = v_profile.vehicle);
  end if;

  perform private.arrive(v_uid);
  update public.profiles
     set parked = jsonb_build_object(
           'x', round(least(greatest(p_x, 0), 720)::numeric, 1),
           'y', round(least(greatest(p_y, 230), 640)::numeric, 1),
           'a', round((p_a - v_turn * floor(p_a / v_turn))::numeric, 3)
         ),
         place = 'outside',
         seen_at = now()
   where id = v_uid;
  return public.get_me();
end;
$$;

-- You drove into a friend's parked vehicle at `p_speed` (car park units a
-- second). A nudge does nothing; harder, both vehicles lose up to 30 health,
-- and they can claim damages. Bumping the same vehicle again within a few
-- seconds is the same crash.
create or replace function public.crash(p_username text, p_speed real)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_me     public.profiles;
  v_owner  public.profiles;
  v_damage integer := least(30, floor(greatest(coalesce(p_speed, 0), 0) / 6))::integer;
  v_theirs integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);

  select p.* into v_owner
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = v_uid
    and private.username_key(p.username) = private.username_key(p_username);
  if not found then
    raise exception 'You can only bump into friends'' vehicles';
  end if;

  -- Both rows, in a fixed order, so two drivers crashing at once can't deadlock.
  perform 1 from public.profiles where id in (v_uid, v_owner.id) order by id for update;
  select * into v_me from public.profiles where id = v_uid;
  select * into v_owner from public.profiles where id = v_owner.id;

  if v_me.vehicle is null or v_me.vehicle_health = 0 then
    raise exception 'You''re not driving anything';
  end if;
  if v_owner.vehicle is null or private.status_of(v_owner.id) = 'absent' then
    raise exception '% hasn''t parked here', v_owner.display_name;
  end if;
  if v_damage < 3 or exists (
    select 1 from public.crashes
    where driver = v_uid and owner = v_owner.id and at > now() - interval '5 seconds'
  ) then
    return public.get_me();
  end if;

  v_theirs := least(v_damage, v_owner.vehicle_health);
  update public.profiles
     set vehicle_health = greatest(0, vehicle_health - v_damage)
   where id in (v_uid, v_owner.id);
  if v_theirs > 0 then
    insert into public.crashes (driver, owner, vehicle, damage, cost)
    values (v_uid, v_owner.id, v_owner.vehicle, v_theirs,
            private.repair_cost(v_owner.vehicle, v_theirs));
  end if;
  return public.get_me();
end;
$$;

-- Claims damages for a crash into your vehicle (the driver pays, or their
-- insurer if they were insured at the time, and it's put right), or lets it go.
create or replace function public.claim_crash(p_id bigint, p_claim boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_crash   public.crashes;
  v_insured boolean;
  v_paid    integer := 0;
begin
  select * into v_crash from public.crashes
  where id = p_id and owner = v_uid and status = 'open'
  for update;
  if not found then
    raise exception 'That''s been settled';
  end if;

  if not coalesce(p_claim, false) then
    update public.crashes set status = 'waived', settled_at = now() where id = p_id;
    return public.get_me();
  end if;

  perform 1 from public.profiles where id in (v_crash.driver, v_uid) order by id for update;
  select coalesce(insured_until > v_crash.at, false) into v_insured
  from public.profiles where id = v_crash.driver;

  if not v_insured then
    select least(v_crash.cost, chips) into v_paid from public.profiles where id = v_crash.driver;
    update public.profiles set chips = chips - v_paid where id = v_crash.driver;
  end if;
  update public.profiles
     set vehicle_health = least(100, vehicle_health + v_crash.damage)
   where id = v_uid and vehicle = v_crash.vehicle;
  update public.crashes
     set status     = 'claimed',
         paid_by    = case when v_insured then 'insurer' else 'driver' end,
         paid       = v_paid,
         settled_at = now()
   where id = p_id;
  return public.get_me();
end;
$$;

-- Crashes you were in: the open ones against your vehicle, and the rest from
-- the last two days.
create or replace function private.crashes_of(p_user uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
    'id',          c.id,
    'driver',      d.username,
    'driver_name', d.display_name,
    'owner',       o.username,
    'owner_name',  o.display_name,
    'vehicle',     c.vehicle,
    'damage',      c.damage,
    'cost',        c.cost,
    'at',          c.at,
    'status',      c.status,
    'paid_by',     c.paid_by,
    'paid',        c.paid
  ) order by c.at desc), '[]'::json)
  from public.crashes c
  join public.profiles d on d.id = c.driver
  join public.profiles o on o.id = c.owner
  where p_user in (c.driver, c.owner)
    and ((c.owner = p_user and c.status = 'open') or c.at > now() - interval '2 days');
$$;

-- Puts your vehicle right, for what the damage costs.
create or replace function public.repair_vehicle()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_profile public.profiles;
  v_cost    integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);
  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.vehicle is null then
    raise exception 'You''ve nothing to repair';
  end if;
  if v_profile.vehicle_health >= 100 then
    raise exception 'It doesn''t need repairing';
  end if;
  v_cost := private.repair_cost(v_profile.vehicle, 100 - v_profile.vehicle_health);
  update public.profiles set chips = chips - v_cost, vehicle_health = 100
   where id = v_uid and chips >= v_cost;
  if not found then
    raise exception 'Not enough chips';
  end if;
  return public.get_shop();
end;
$$;

-- A week's insurance: claims against you while it lasts are paid for you.
create or replace function public.buy_insurance()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_profile public.profiles;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);
  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.vehicle is null then
    raise exception 'You''ve nothing to insure';
  end if;
  if v_profile.insured_until > now() + 3 * private.insurance_lasts() then
    raise exception 'You''re insured for weeks yet';
  end if;
  update public.profiles
     set chips = chips - private.insurance_price(),
         insured_until = greatest(now(), coalesce(insured_until, now())) + private.insurance_lasts()
   where id = v_uid and chips >= private.insurance_price();
  if not found then
    raise exception 'Not enough chips';
  end if;
  return public.get_shop();
end;
$$;

-- As in 0002, plus: a new vehicle arrives without a scratch.
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
    update public.profiles set vehicle = v_item.slug, vehicle_health = 100 where id = v_uid;
  end if;

  return public.get_shop();
end;
$$;

-- As in 0006, plus your vehicle's repair and your insurance.
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
      )
    )
    from public.profiles p
    where p.id = v_uid
  );
end;
$$;

-- As in 0007, but anywhere at work: in the garden or the car park.
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

-- As in 0013, plus where friends parked, how their vehicles are, and when
-- their cigarette burns out.
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
        p.vehicle_health,
        case when pr.status <> 'absent' then p.parked end as parked,
        private.desk_items_of(p.id) as desk_items,
        case when p.activity_until > now() then p.activity end as activity,
        case when p.activity_until > now() then p.activity_until end as activity_until
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_friends)
    ) b
  );
end;
$$;

-- As in 0013, plus where they parked and how their vehicles are.
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
        p.vehicle_health,
        p.parked,
        private.desk_items_of(p.id) as desk_items,
        private.friends_in_common(v_uid, p.id) as via
      from public.profiles p
      cross join lateral private.presence(p.id) pr
      where p.id = any (v_others) and pr.status <> 'absent'
    ) b
  );
end;
$$;

-- As in 0014, plus the car park's channels: "carpark:<username>", where
-- you are, for friends and their friends; "carpark-chat:<username>", what
-- you say, for friends only.
create or replace function public.may_listen(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p_topic in ('garden:' || p.username, 'garden-chat:' || p.username,
                      'carpark:' || p.username, 'carpark-chat:' || p.username)
      and (
        p.id = auth.uid()
        or exists (
          select 1 from public.friendships f
          where f.user_id = auth.uid() and f.friend_id = p.id
        )
        or (p_topic in ('garden:' || p.username, 'carpark:' || p.username)
            and p.id = any (private.friends_of_friends(auth.uid())))
      )
  );
$$;

-- Hearing goes by may_listen, so its policy (still named for the garden)
-- covers the car park now. Speaking lists the topics, so it's replaced.
drop policy "garden: speak only on your own channels" on realtime.messages;
create policy "garden and car park: speak only on your own channels" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and (select realtime.topic()) in ('garden:' || p.username, 'garden-chat:' || p.username,
                                          'carpark:' || p.username, 'carpark-chat:' || p.username)
    )
  );

-- ---------------------------------------------------------------------------
-- get_me
-- ---------------------------------------------------------------------------

-- As in 0016, plus hard mode, your email, your vehicle's state and crashes.
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

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.set_hard_mode(boolean),
  public.set_email(text),
  public.check_signup(text, text, text),
  public.invite_to_session(),
  public.use_invite(text, text),
  public.park(real, real, real),
  public.crash(text, real),
  public.claim_crash(bigint, boolean),
  public.repair_vehicle(),
  public.buy_insurance()
from public, anon;

grant execute on function
  public.set_hard_mode(boolean),
  public.set_email(text),
  public.invite_to_session(),
  public.use_invite(text, text),
  public.park(real, real, real),
  public.crash(text, real),
  public.claim_crash(bigint, boolean),
  public.repair_vehicle(),
  public.buy_insurance()
to authenticated;

grant execute on function public.check_signup(text, text, text) to anon, authenticated;
