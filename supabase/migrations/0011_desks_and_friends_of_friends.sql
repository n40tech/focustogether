-- Focus, part 11: friends of friends in the office, and changing desks.
--   * get_friends_of_friends: friends of your friends (not your friends, and
--     not you) who are at work, with their desk, car and desk things, and
--     which of your friends they know. The app shows them greyed out, and
--     you can ask them to be friends.
--   * arriving now hands you a desk none of your friends or their friends is
--     using, so different friend circles rarely sit in the same seat
--   * switch_desk: move to a free desk while you're at work and not studying.
--     Your bay and rack slot follow, as they follow your desk.
-- Run after 0010_friend_requests_and_joining.sql.

-- Friends of p_user's friends: not p_user, and not p_user's friends.
create or replace function private.friends_of_friends(p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct theirs.friend_id), '{}')
  from public.friendships mine
  join public.friendships theirs on theirs.user_id = mine.friend_id
  where mine.user_id = p_user
    and theirs.friend_id <> p_user
    and not exists (
      select 1 from public.friendships f
      where f.user_id = p_user and f.friend_id = theirs.friend_id
    );
$$;

-- Whose desks you mustn't share: your friends and theirs.
create or replace function private.circle_of(p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(friend_id), '{}') || private.friends_of_friends(p_user)
  from public.friendships where user_id = p_user;
$$;

-- As in 0006, but avoiding friends of friends' desks too.
create or replace function private.arrive(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_circle uuid[] := private.circle_of(p_user_id);
  v_desk   smallint;
begin
  perform private.finalize_expired(v_circle || p_user_id);

  if private.status_of(p_user_id) <> 'absent' then
    return;
  end if;

  select d into v_desk
  from generate_series(0, 11) d
  where not exists (
    select 1 from public.profiles p
    where p.id = any (v_circle)
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

-- Moves you to another desk, if nobody in your circle is at it. You sit down there.
create or replace function public.switch_desk(p_desk integer)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_circle uuid[] := private.circle_of(v_uid);
  v_status text;
begin
  if p_desk is null or p_desk not between 0 and 11 then
    raise exception 'There''s no desk %', coalesce(p_desk::text, 'there');
  end if;

  perform private.finalize_expired(v_circle || v_uid);
  v_status := private.status_of(v_uid);
  if v_status = 'focused' then
    raise exception 'You can''t change desks while you''re studying';
  end if;
  if v_status = 'absent' then
    raise exception 'Walk into the office first';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = any (v_circle)
      and p.desk = p_desk
      and private.status_of(p.id) <> 'absent'
  ) then
    raise exception 'Someone''s at that desk';
  end if;

  update public.profiles
     set desk = p_desk, place = 'office', seen_at = now()
   where id = v_uid;
  return public.get_me();
end;
$$;

-- Friends of your friends who are at work, as get_friends_board has your
-- friends, plus `via`: which of your friends they know.
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
        (
          select coalesce(json_agg(i.item order by it.sort), '[]'::json)
          from public.inventory i
          join public.items it on it.slug = i.item
          where i.user_id = p.id and it.kind = 'desk'
        ) as desk_items,
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
  public.switch_desk(integer),
  public.get_friends_of_friends()
from public, anon;

grant execute on function
  public.switch_desk(integer),
  public.get_friends_of_friends()
to authenticated;
