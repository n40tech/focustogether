-- Focus, part 15: notifications (web push), even when Focus Together is closed.
--   * push_subscriptions: where each device that turned notifications on
--     can be reached (save_push and drop_push, from the app)
--   * due_pushes: what to send now, each marked as sent so it goes once.
--     The "push" Edge Function asks for it every minute (a Supabase Cron
--     job, set up as deployment/0005-friends-and-looks.md says) and sends it:
--       - "Bob is studying right now", to his friends who aren't studying
--       - "Your session's done" and "Your break's over", to you
--       - "Carol would like to be friends", to whoever she asked
--     Only things from the last 10 minutes are sent, so nothing old turns up
--     after a gap (or from before this ran).
-- Run after 0014_circles_and_last_active.sql.

create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "read your own devices" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.sessions
  add column start_pushed_at timestamptz,
  add column end_pushed_at   timestamptz,
  add column break_pushed_at timestamptz;

alter table public.friend_requests add column pushed_at timestamptz;

-- Everything so far counts as sent.
update public.sessions
   set start_pushed_at = now(), end_pushed_at = now(), break_pushed_at = now();
update public.friend_requests set pushed_at = now();

-- This device can be reached at `endpoint`, for you. A device someone else
-- signed in on before becomes yours.
create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, v_uid, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

-- This device wants no more notifications (turned off, or signed out).
create or replace function public.drop_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid;
end;
$$;

-- What to send now, one row per device, each marked as sent. For the
-- service role only (the "push" Edge Function).
create or replace function public.due_pushes()
returns table (endpoint text, p256dh text, auth text, title text, body text, url text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_since timestamptz := now() - interval '10 minutes';
begin
  -- Sessions whose time is up finish now, so their ends can be told.
  perform private.finalize_expired(array(
    select distinct s.user_id from public.sessions s where s.status = 'active'
  ));

  -- A friend has started studying: tell friends who aren't.
  return query
    with started as (
      update public.sessions s
         set start_pushed_at = now()
       where s.start_pushed_at is null
      returning s.user_id, s.status, s.started_at, s.duration_min
    )
    select ps.endpoint, ps.p256dh, ps.auth,
           p.display_name || ' is studying right now',
           format('%s minutes. Join them in the office?', st.duration_min),
           '/office'
    from started st
    join public.profiles p on p.id = st.user_id
    join public.friendships f on f.user_id = st.user_id
    join public.push_subscriptions ps on ps.user_id = f.friend_id
    where st.status = 'active'
      and st.started_at > v_since
      and private.status_of(f.friend_id) <> 'focused';

  -- Your session is done.
  return query
    with done as (
      update public.sessions s
         set end_pushed_at = now()
       where s.end_pushed_at is null and s.status <> 'active'
      returning s.user_id, s.status, s.ended_at, s.chips, s.duration_min
    )
    select ps.endpoint, ps.p256dh, ps.auth,
           'Your session''s done',
           format('%s chips, and a %s-minute break.',
                  coalesce(d.chips, d.duration_min), private.break_minutes(d.duration_min)),
           '/payout'
    from done d
    join public.push_subscriptions ps on ps.user_id = d.user_id
    where d.status = 'completed' and d.ended_at > v_since;

  -- Your break is over: if it ran out on its own (you didn't go home or
  -- start another session first).
  return query
    with over as (
      update public.sessions s
         set break_pushed_at = now()
       where s.break_pushed_at is null
         and (s.status = 'cancelled'
           or (s.status = 'completed'
               and s.ended_at + make_interval(mins => private.break_minutes(s.duration_min)) <= now()))
      returning s.user_id, s.status, s.ended_at,
                s.ended_at + make_interval(mins => private.break_minutes(s.duration_min)) as ends_at
    )
    select ps.endpoint, ps.p256dh, ps.auth,
           'Your break''s over',
           'Back to the office, or home?',
           '/'
    from over o
    join public.profiles p on p.id = o.user_id
    join public.push_subscriptions ps on ps.user_id = o.user_id
    where o.status = 'completed'
      and o.ends_at > v_since
      and (p.went_home_at is null or p.went_home_at not between o.ended_at and o.ends_at)
      and not exists (
        select 1 from public.sessions later
        where later.user_id = o.user_id and later.started_at > o.ended_at
      );

  -- Someone would like to be friends.
  return query
    with asked as (
      update public.friend_requests r
         set pushed_at = now()
       where r.pushed_at is null
      returning r.from_id, r.to_id, r.created_at
    )
    select ps.endpoint, ps.p256dh, ps.auth,
           p.display_name || ' would like to be friends',
           'Answer on the Friends board.',
           '/friends'
    from asked a
    join public.profiles p on p.id = a.from_id
    join public.push_subscriptions ps on ps.user_id = a.to_id
    where a.created_at > v_since;
end;
$$;

-- Devices the push services say have gone (unsubscribed, or uninstalled).
create or replace function public.forget_pushes(p_endpoints text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.save_push(text, text, text),
  public.drop_push(text),
  public.due_pushes(),
  public.forget_pushes(text[])
from public, anon, authenticated;

grant execute on function public.save_push(text, text, text), public.drop_push(text)
to authenticated;

grant execute on function public.due_pushes(), public.forget_pushes(text[]) to service_role;
