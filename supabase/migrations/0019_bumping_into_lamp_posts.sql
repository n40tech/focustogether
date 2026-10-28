-- Focus, part 19: bumping into lamp posts.
--   * Driving into a lamp post in the car park damages your own vehicle, as
--     driving into a friend's does (up to 30 health, by speed; a nudge does
--     nothing). There's nobody to claim. Bumping it again within a few
--     seconds is the same bump (profiles.bumped_at).
-- Run after 0018_parking_in_the_rack.sql.

alter table public.profiles add column bumped_at timestamptz;

-- You drove into a lamp post at `p_speed` (car park units a second).
create or replace function public.bump(p_speed real)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_me     public.profiles;
  v_damage integer := least(30, floor(greatest(coalesce(p_speed, 0), 0) / 6))::integer;
begin
  perform private.finalize_expired(array[v_uid]);
  perform private.require_not_studying(v_uid);

  select * into v_me from public.profiles where id = v_uid for update;
  if v_me.vehicle is null or v_me.vehicle_health = 0 then
    raise exception 'You''re not driving anything';
  end if;
  if v_damage < 3 or v_me.bumped_at > now() - interval '3 seconds' then
    return public.get_me();
  end if;

  update public.profiles
     set vehicle_health = greatest(0, vehicle_health - v_damage), bumped_at = now()
   where id = v_uid;
  return public.get_me();
end;
$$;

revoke execute on function public.bump(real) from public, anon;
grant execute on function public.bump(real) to authenticated;
