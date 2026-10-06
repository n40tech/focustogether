-- Focus, part 9: telling a skipped first session from a studied one.
--   * a session ended early by skip_first_session is marked skipped
--   * get_me says how many sessions you've studied (sessions_done, less the
--     skipped one), so the app can wait for a real one before suggesting you
--     invite friends. Sessions skipped before this ran can't be told apart,
--     so they count as studied.
-- Run after 0008_accents_and_unfriending.sql: SQL Editor -> New query -> paste this file -> Run.

alter table public.sessions add column skipped boolean not null default false;

-- As in 0007, and marks the session skipped.
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
         left_at      = null,
         skipped      = true
   where user_id = v_uid and status = 'active';

  if not found then
    raise exception 'No session is running';
  end if;

  perform private.finalize_expired(array[v_uid]);
  return public.get_me();
end;
$$;

-- As in 0007, plus sessions_studied: finished sessions that weren't skipped.
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
