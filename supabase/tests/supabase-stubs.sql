-- Minimal stand-ins for the parts of Supabase the migrations use (auth.uid(),
-- the API roles, Realtime's messages table), so the migrations can run and be
-- tested on a plain Postgres. Test-only: never run this against Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
grant anon, authenticated, service_role to current_user;

-- auth: users, and auth.uid() read from the JWT claim PostgREST would set.
create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb,
  created_at         timestamptz not null default now()
);
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- realtime: the table Realtime Authorization checks RLS against.
create schema realtime;
create table realtime.messages (
  id          bigint generated always as identity primary key,
  topic       text not null,
  extension   text not null,
  payload     jsonb,
  event       text,
  private     boolean default true,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text
language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
grant execute on function realtime.topic() to authenticated;

-- Supabase gives the API roles full table and function access by default and
-- relies on RLS and explicit revokes; mirror that.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
