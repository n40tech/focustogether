# 0008 · The car park, put right

**Where you are:** the real project has had migrations 0001 to 0017
(`deployment/0001-setup-and-launch.md`, step 2, checks which).

**What this update brings:**

- the car park looks as it did before driving came in: one phone wide,
  three even rows of four bays, the bike rack and the hedge where they were,
  and no road. You drive in from the right-hand side;
- you park only in a free bay, or with a bike in a free slot of the rack
  (bikes can ride up onto the pavement for it). Stopped in one, **Park
  here** straightens it up. You can't walk in until you've parked;
- you **Get on** a bike, and you're drawn riding it;
- walking out of the office no longer puts you in the doorway, so your
  first step doesn't take you back inside;
- on a computer, the car park's panel is shorter (no thumbstick: the arrow
  keys steer), so the scene is bigger.

Nobody's data changes. Vehicles parked under the old layout stay where they
were until their owners next park.

---

## 1. Run migration 0018, before the app that needs it goes out

The new app parks bikes up on the pavement, which the old `park` moves down
to the kerb. Run it just before merging the pull request.

Check it hasn't been run already:

```sql
select position('-80' in pg_get_functiondef('public.park(real, real, real)'::regprocedure)) > 0 as done;
```

If that says `false`, run `supabase/migrations/0018_parking_in_the_rack.sql`
once (Claude does this through the Supabase connector, md5-guarded, as
`CLAUDE.md` describes). Afterwards, the same query says `true`.

## 2. Merge

Merging deploys the app (GitHub Actions). Then, on a computer and a phone:

- [ ] The car park looks as it used to, and isn't tiny on a computer.
- [ ] Coming back with a vehicle, you're at the right-hand edge in it.
      **Walk in** says to park first. Drive into a free bay, stop, and
      **Park here**.
- [ ] With a bike: **Get on**, ride up into the rack, and park.
- [ ] Walk out of the office and away from the door: you stay outside.
