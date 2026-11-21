-- Focus, part 20: invites from the website.
--   * The website (site/) gives an invite to anyone who gets to the end of
--     it: public.website_invite(), which works without signing in.
--   * A website invite is made by nobody, so whoever joins with it starts
--     with no friends (the sign-up form says it's from Focus). It's good for
--     2 days.
--   * Between them, everyone gets at most 10 an hour and 30 a day. Past
--     that, it says so (reason 'busy'), and the website says to come back
--     later.
-- Run after 0019_bumping_into_lamp_posts.sql.

alter table public.invites add column from_website boolean not null default false;

-- A new invite from the website: { code, expires_at }, or { code: null,
-- reason: 'busy' } once the hour's or the day's are gone.
create or replace function public.website_invite()
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hour    integer;
  v_day     integer;
  v_code    text;
  v_expires timestamptz := now() + interval '2 days';
begin
  -- One at a time, so two visitors at once can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('public.website_invite'));

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
  into v_hour, v_day
  from public.invites
  where from_website;
  if v_hour >= 10 or v_day >= 30 then
    return json_build_object('code', null, 'reason', 'busy');
  end if;

  v_code := private.make_invite();
  update public.invites set from_website = true, expires_at = v_expires where code = v_code;
  return json_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

revoke execute on function public.website_invite() from public;
-- The website calls it before there's an account.
grant execute on function public.website_invite() to anon, authenticated;
