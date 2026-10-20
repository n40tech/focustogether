-- Focus, part 12: choosing how you look.
--   * profiles.looks: a skin tone, a favourite colour (your shirt, and your
--     dot on the Friends board), a hairstyle and a hair colour. Null until you
--     choose; until then the app picks from your username, as before.
--   * set_looks saves yours, from the choices the app offers
--   * get_looks: how you, your friends and their friends look, by username
-- Run after 0011_desks_and_friends_of_friends.sql.

-- Skin 0-5, colour 0-7 and hair colour 0-5 index the app's palettes
-- (src/lib/looks.ts); hair is one of five styles. Nothing else is allowed.
create or replace function private.is_looks(p_looks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- (Only an object can have keys taken away, hence the case.)
  select case when jsonb_typeof(p_looks) = 'object' then coalesce(
    p_looks - array['skin', 'colour', 'hair', 'hair_colour'] = '{}'::jsonb
    and jsonb_typeof(p_looks -> 'skin') = 'number' and p_looks ->> 'skin' ~ '^[0-5]$'
    and jsonb_typeof(p_looks -> 'colour') = 'number' and p_looks ->> 'colour' ~ '^[0-7]$'
    and jsonb_typeof(p_looks -> 'hair_colour') = 'number' and p_looks ->> 'hair_colour' ~ '^[0-5]$'
    and p_looks ->> 'hair' in ('short', 'long', 'bun', 'curly', 'shaved'),
    false
  ) else false end;
$$;

alter table public.profiles
  add column looks jsonb check (looks is null or private.is_looks(looks));

-- How you, your friends and your friends' friends look, by username. Anyone
-- who hasn't chosen is left out, and the app picks for them.
create or replace function public.get_looks()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return (
    select coalesce(json_object_agg(p.username, p.looks), '{}'::json)
    from public.profiles p
    where p.looks is not null
      and (p.id = v_uid
        or p.id in (select friend_id from public.friendships where user_id = v_uid)
        or p.id = any (private.friends_of_friends(v_uid)))
  );
end;
$$;

create or replace function public.set_looks(p_looks jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if not private.is_looks(p_looks) then
    raise exception 'That look isn''t one of the choices';
  end if;
  update public.profiles set looks = p_looks where id = v_uid;
  return public.get_looks();
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function public.get_looks(), public.set_looks(jsonb) from public, anon;
grant execute on function public.get_looks(), public.set_looks(jsonb) to authenticated;
