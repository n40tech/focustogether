-- Focus, part 18: parking in the rack.
--   * The car park is back to one phone wide, with the bike rack up on the
--     pavement and a way in from the side. park keeps a vehicle to that:
--     from the pavement (for bikes in the rack) to just past the bottom, and
--     a little past either side.
-- Run after 0017_hard_mode_driving_and_study_invites.sql.

-- As in 0017, with the car park's new edges.
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
           'x', round(least(greatest(p_x, -80), 460)::numeric, 1),
           'y', round(least(greatest(p_y, 150), 660)::numeric, 1),
           'a', round((p_a - v_turn * floor(p_a / v_turn))::numeric, 3)
         ),
         place = 'outside',
         seen_at = now()
   where id = v_uid;
  return public.get_me();
end;
$$;
