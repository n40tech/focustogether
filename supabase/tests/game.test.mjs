// Scenario tests for supabase/migrations: they run on a plain Postgres with
// supabase-stubs.sql standing in for Supabase's auth and Realtime schemas.
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
//
// The database in DATABASE_URL is only used to create a scratch database,
// focus_test, which is dropped and rebuilt from the migrations on every run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, '..', 'migrations');
const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const testUrl = new URL(adminUrl);
testUrl.pathname = '/focus_test';

const db = new pg.Client({ connectionString: testUrl.toString() });
const ids = {};

async function q(text, params) {
  return (await db.query(text, params)).rows;
}

/** Calls public.<fn>(...args) as `user` (role authenticated), like supabase.rpc. */
async function call(user, fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  await db.query('begin');
  try {
    if (user !== 'anon') {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ids[user]]);
      await db.query('set local role authenticated');
    } else {
      await db.query('set local role anon');
    }
    const { rows } = await db.query(`select public.${fn}(${ph}) as r`, args);
    await db.query('commit');
    return rows[0].r;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

/** Runs a query as `user` with an optional Realtime topic, returning rows. */
async function asUser(user, text, params = [], topic = null) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ids[user]]);
    if (topic) await db.query(`select set_config('realtime.topic', $1, true)`, [topic]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(text, params);
    await db.query('commit');
    return rows;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

/** What Supabase Auth does on sign-up: insert the user with the form's metadata. */
async function signUp(username, invite, { email, name } = {}) {
  const [u] = await q(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [
      email ?? `${username}@focus.test`,
      { invite, username, display_name: name ?? username[0].toUpperCase() + username.slice(1) },
    ]
  );
  ids[username] = u.id;
  return u.id;
}

/** Moves every stored timestamp back, which is the same as `minutes` passing. */
async function travel(minutes) {
  const m = `make_interval(mins => ${Number(minutes)})`;
  await q(`update public.sessions set started_at = started_at - ${m}, ended_at = ended_at - ${m}`);
  await q(
    `update public.profiles set went_home_at = went_home_at - ${m}, activity_until = activity_until - ${m},
       arrived_at = arrived_at - ${m}`
  );
  await q(
    `update public.plots set planted_at = planted_at - ${m}, watered_at = watered_at - ${m},
       ripe_at = ripe_at - ${m}`
  );
  await q(`update public.trades set created_at = created_at - ${m}, closed_at = closed_at - ${m}`);
  await q(`update public.invites set expires_at = expires_at - ${m}`);
}

async function give(user, item, qty) {
  await q(
    `insert into public.inventory (user_id, item, qty) values ($1, $2, $3)
     on conflict (user_id, item) do update set qty = excluded.qty`,
    [ids[user], item, qty]
  );
}

async function setChips(user, chips) {
  await q('update public.profiles set chips = $2 where id = $1', [ids[user], chips]);
}

/**
 * Completes a session of `minutes` for each user at the same time, leaving them
 * all at the start of their break. (Time travel moves everyone's timestamps.)
 */
async function study(users, minutes) {
  const list = Array.isArray(users) ? users : [users];
  for (const user of list) await call(user, 'start_session', minutes);
  await travel(minutes);
  return call(list[0], 'get_me');
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.match(e.message, pattern);
    return true;
  });
}

/** A session pays its minutes, give or take up to 12%. */
function assertPayout(chips, minutes) {
  const slack = Math.round(0.12 * minutes);
  assert.ok(
    chips >= Math.max(1, minutes - slack) && chips <= minutes + slack,
    `${chips} chips for ${minutes} minutes`
  );
}

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('drop database if exists focus_test');
  await admin.query('create database focus_test');
  await admin.end();

  await db.connect();
  await db.query(fs.readFileSync(path.join(here, 'supabase-stubs.sql'), 'utf8'));
  for (const file of fs
    .readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.query(fs.readFileSync(path.join(migrations, file), 'utf8'));
  }

  // alice gets an invite made in the SQL editor; she invites bob, who invites
  // carol. So alice <-> bob <-> carol, but alice and carol aren't friends.
  const [{ code }] = await q('select private.make_invite() as code');
  await signUp('alice', code);
  await signUp('bob', (await call('alice', 'create_invite')).code);
  await signUp('carol', (await call('bob', 'create_invite')).code);
});

beforeEach(async () => {
  await q(
    'truncate public.sessions, public.inventory, public.plots, public.trades, public.listings'
  );
  await q(
    `update public.profiles set chips = 0, vehicle = null, went_home_at = null, activity = null,
       activity_until = null, arrived_at = null, desk = null, tester = false`
  );
});

after(async () => {
  await db.end();
});

describe('sessions, breaks and chips', () => {
  test('a new player is absent with no chips, vehicle, desk or inventory', async () => {
    const me = await call('alice', 'get_me');
    assert.equal(me.status, 'absent');
    assert.equal(me.chips, 0);
    assert.equal(me.vehicle, null);
    assert.equal(me.desk, null);
    assert.deepEqual(me.inventory, {});
    assert.equal(me.break_ends_at, null);
  });

  test('studying locks everything else', async () => {
    const me = await call('alice', 'start_session', 25);
    assert.equal(me.status, 'focused');
    assert.equal(me.active_session.duration_min, 25);
    await rejects(call('alice', 'start_session', 25), /already running/);
    await rejects(call('alice', 'buy', 'mug'), /studying/);
    await rejects(call('alice', 'water'), /on a break/);
    await rejects(call('alice', 'go_home'), /Give up/);
  });

  test('completing a session pays about a chip a minute and earns 1 min of break per 5', async () => {
    const me = await study('alice', 25);
    assert.equal(me.status, 'on_break');
    assertPayout(me.chips, 25);
    assert.equal(me.last_completed.chips, me.chips);
    assert.equal(me.active_session, null);
    assert.equal(me.last_completed.duration_min, 25);
    assert.equal(me.last_completed.break_min, 5);
    const breakMs = Date.parse(me.break_ends_at) - Date.parse(me.last_completed.ended_at);
    assert.equal(breakMs, 5 * 60_000);

    // Finalizing again must not pay twice.
    assert.equal((await call('alice', 'get_me')).chips, me.chips);
  });

  test('payouts are close to a chip a minute, with a little luck either way', async () => {
    const payouts = [];
    for (let i = 0; i < 40; i++) {
      await call('alice', 'start_session', 50);
      await travel(70);
      payouts.push((await call('alice', 'get_me')).last_completed.chips);
    }
    payouts.forEach((p) => assertPayout(p, 50));
    assert.ok(new Set(payouts).size > 3, `some variety: ${payouts.join(', ')}`);
    const mean = payouts.reduce((a, b) => a + b, 0) / payouts.length;
    assert.ok(Math.abs(mean - 50) < 2.5, `mean ${mean}`);
    // A one-minute session always pays its one chip.
    await call('alice', 'start_session', 1);
    await travel(2);
    assert.equal((await call('alice', 'get_me')).last_completed.chips, 1);
  });

  test('break lengths round to the nearest minute, minimum 1', async () => {
    const rows = await q(
      `select d, private.break_minutes(d) as b from unnest(array[1, 2, 3, 7, 8, 25, 50, 90, 120]) d`
    );
    assert.deepEqual(
      rows.map((r) => [r.d, r.b]),
      [
        [1, 1],
        [2, 1],
        [3, 1],
        [7, 1],
        [8, 2],
        [25, 5],
        [50, 10],
        [90, 18],
        [120, 24],
      ]
    );
  });

  test('after the break you are idle for 15 minutes, then absent', async () => {
    await study('alice', 25); // 5 minute break
    await travel(4);
    assert.equal((await call('alice', 'get_me')).status, 'on_break');
    await travel(2);
    assert.equal((await call('alice', 'get_me')).status, 'idle');
    await travel(13); // 19 minutes after the session ended
    assert.equal((await call('alice', 'get_me')).status, 'idle');
    await travel(2);
    assert.equal((await call('alice', 'get_me')).status, 'absent');
  });

  test('going home ends the break at once', async () => {
    await study('alice', 25);
    const me = await call('alice', 'go_home');
    assert.equal(me.status, 'absent');
    assert.equal(me.desk, null);
    await rejects(call('alice', 'water'), /on a break/);
  });

  test('a new session after going home counts again', async () => {
    const first = await study('alice', 10);
    await call('alice', 'go_home');
    await travel(1);
    const me = await study('alice', 10);
    assert.equal(me.status, 'on_break');
    assertPayout(me.chips - first.chips, 10);
  });

  test('giving up pays nothing, earns no break and leaves you idle', async () => {
    await call('alice', 'start_session', 50);
    await travel(20);
    const me = await call('alice', 'cancel_session');
    assert.equal(me.chips, 0);
    assert.equal(me.status, 'idle');
    assert.equal(me.break_ends_at, null);
    await rejects(call('alice', 'water'), /on a break/);
    await travel(16);
    assert.equal((await call('alice', 'get_me')).status, 'absent');
  });
});

describe('arriving and desks', () => {
  test('walking into the office hands you a desk until you go home', async () => {
    let me = await call('alice', 'arrive');
    assert.equal(me.status, 'idle');
    assert.ok(me.desk >= 0 && me.desk <= 11);
    const desk = me.desk;

    // Arriving again, studying and taking a break all keep the same desk.
    assert.equal((await call('alice', 'arrive')).desk, desk);
    me = await study('alice', 25);
    assert.equal(me.status, 'on_break');
    assert.equal(me.desk, desk);
    await travel(6);
    assert.equal((await call('alice', 'get_me')).desk, desk);

    me = await call('alice', 'go_home');
    assert.equal(me.desk, null);
  });

  test('arriving and doing nothing for 15 minutes counts as going home', async () => {
    await call('alice', 'arrive');
    await travel(14);
    assert.equal((await call('alice', 'get_me')).status, 'idle');
    await travel(2);
    const me = await call('alice', 'get_me');
    assert.equal(me.status, 'absent');
    assert.equal(me.desk, null);
  });

  test('starting a session without arriving first still gets you a desk', async () => {
    const me = await call('alice', 'start_session', 25);
    assert.ok(me.desk >= 0 && me.desk <= 11);
  });

  test('you never get a desk a friend at work is using', async () => {
    for (let round = 0; round < 12; round++) {
      const bob = await call('bob', 'arrive');
      const alice = await call('alice', 'arrive');
      assert.notEqual(alice.desk, bob.desk);
      await call('alice', 'go_home');
      await call('bob', 'go_home');
    }
  });

  test('friends see your desk, and when you arrived, while you are at work', async () => {
    await call('alice', 'arrive');
    const board = await call('bob', 'get_friends_board');
    const alice = board.find((f) => f.username === 'alice');
    assert.equal(alice.status, 'idle');
    assert.ok(alice.desk >= 0);
    assert.ok(alice.arrived_at);
    await call('alice', 'go_home');
    const after = (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice');
    assert.equal(after.desk, null);
  });
});

describe('the kiosk', () => {
  test('sells packs, one-off desk items and vehicles', async () => {
    await rejects(call('alice', 'buy', 'mug'), /Not enough chips/);
    await setChips('alice', 500);

    let shop = await call('alice', 'buy', 'tomato_seeds');
    assert.equal(shop.chips, 485);
    assert.equal(shop.items.find((i) => i.slug === 'tomato_seeds').owned, 3);

    shop = await call('alice', 'buy', 'mug');
    assert.equal(shop.items.find((i) => i.slug === 'mug').owned, 1);
    await rejects(call('alice', 'buy', 'mug'), /already have the mug/);

    await call('alice', 'buy', 'bike');
    assert.equal((await call('alice', 'get_me')).vehicle, 'bike');
    shop = await call('alice', 'buy', 'hatchback');
    assert.equal(shop.chips, 500 - 15 - 10 - 60 - 300);
    assert.equal((await call('alice', 'get_me')).vehicle, 'hatchback');

    await rejects(call('alice', 'buy', 'tomato'), /isn't for sale/);
    await rejects(call('alice', 'buy', 'nonsense'), /isn't for sale/);

    // Produce is never on sale; the catalogue lists vehicles first.
    assert.ok(shop.items.every((i) => i.kind !== 'produce'));
    assert.equal(shop.items[0].kind, 'vehicle');
    assert.equal(shop.items.find((i) => i.slug === 'tomato_seeds').grow_min, 120);
  });
});

describe('the allotment', () => {
  test('crops grow by the minutes studied while watered, then harvest into produce', async () => {
    await give('alice', 'tomato_seeds', 3);
    await study('alice', 25);
    let garden = await call('alice', 'plant', 0, 'tomato_seeds');
    assert.equal(garden.me.inventory.tomato_seeds, 2);
    assert.deepEqual(
      garden.me.plots.map((p) => [p.bed, p.crop, p.growth_min, p.ripe, p.watered]),
      [[0, 'tomato', 0, false, true]]
    );
    await rejects(call('alice', 'plant', 0, 'tomato_seeds'), /already growing/);
    await rejects(call('alice', 'plant', 4, 'tomato_seeds'), /no bed 4/);
    await rejects(call('alice', 'plant', 1, 'tomato'), /aren't seeds/);
    await rejects(call('alice', 'harvest', 0), /Nothing is ripe/);

    await travel(1);
    await study('alice', 60);
    garden = await call('alice', 'get_garden');
    assert.equal(garden.me.plots[0].growth_min, 60);

    await travel(1);
    await study('alice', 90); // growth is capped at grow_min
    garden = await call('alice', 'get_garden');
    assert.equal(garden.me.plots[0].growth_min, 120);
    assert.equal(garden.me.plots[0].ripe, true);

    garden = await call('alice', 'harvest', 0);
    assert.deepEqual(garden.me.plots, []);
    assert.equal(garden.me.inventory.tomato, 4);
  });

  test('a ripe crop keeps for 2 days, then withers to nothing until the bed is cleared', async () => {
    await give('alice', 'radish_seeds', 2);
    await study('alice', 25);
    await call('alice', 'plant', 0, 'radish_seeds');
    await travel(1);
    let me = await study('alice', 25); // the radishes ripen as this session ends
    assert.deepEqual(
      me.ripe.map((r) => [r.bed, r.crop]),
      [[0, 'radish']]
    );
    let [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [true, false]);
    assert.equal(Date.parse(plot.withers_at) - Date.parse(plot.ripe_at), 2 * 24 * 60 * 60 * 1000);
    assert.equal(me.ripe[0].withers_at, plot.withers_at);
    await rejects(call('alice', 'clear_bed', 0), /nothing withered/);

    // A day and 23 hours on (and another short session), they're still good...
    await travel(47 * 60);
    await study('alice', 5);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [true, false]);

    // ...but an hour later they've withered: nothing to pick, and not "ripe" any more.
    await travel(60);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [false, true]);
    assert.deepEqual((await call('alice', 'get_me')).ripe, []);
    await study('alice', 5);
    await rejects(call('alice', 'harvest', 0), /withered/);
    await rejects(call('alice', 'plant', 0, 'radish_seeds'), /already growing/);

    const garden = await call('alice', 'clear_bed', 0);
    assert.deepEqual(garden.me.plots, []);
    assert.equal(garden.me.inventory.radish, undefined, 'a withered crop gives nothing');
    await call('alice', 'plant', 0, 'radish_seeds');
  });

  test('a crop ripens when its session ends, even if nobody looks until later', async () => {
    await give('alice', 'radish_seeds', 1);
    await study('alice', 25);
    await call('alice', 'plant', 0, 'radish_seeds');
    await travel(1);
    await call('alice', 'start_session', 25);
    // The session ended three days ago, and this is the first anyone has asked.
    await travel(25 + 3 * 24 * 60);
    const [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.growth_min, plot.withered], [25, true]);
  });

  test('unwatered beds pause, and planting during a break only counts from the next session', async () => {
    await give('alice', 'radish_seeds', 2);
    await study('alice', 25);
    await call('alice', 'plant', 0, 'radish_seeds');
    await call('alice', 'plant', 1, 'radish_seeds');
    // Bed 1 dries out: watered more than a day before the next session ends.
    await q(`update public.plots set watered_at = now() - interval '2 days' where bed = 1`);
    await travel(1);
    await study('alice', 30);
    let garden = await call('alice', 'get_garden');
    assert.deepEqual(
      garden.me.plots.map((p) => [p.bed, p.growth_min, p.watered]),
      [
        [0, 25, true],
        [1, 0, false],
      ]
    );

    garden = await call('alice', 'water');
    assert.ok(garden.me.plots.every((p) => p.watered));
  });

  test("you can water a friend's beds, but not harvest them", async () => {
    await give('bob', 'radish_seeds', 1);
    await study(['alice', 'bob'], 25);
    await call('bob', 'plant', 0, 'radish_seeds');
    await q(`update public.plots set watered_at = now() - interval '2 days' where user_id = $1`, [
      ids.bob,
    ]);

    const garden = await call('alice', 'water_friend', 'bob');
    assert.equal(garden.neighbours.find((n) => n.username === 'bob').plots[0].watered, true);
    await rejects(call('alice', 'water_friend', 'carol'), /only water a friend/);
    // There's no way to harvest someone else's bed: harvest only ever looks at your own.
    await rejects(call('alice', 'harvest', 0), /Nothing is ripe/);
    await call('alice', 'go_home');
    await rejects(call('alice', 'water_friend', 'bob'), /on a break/);
  });

  test('produce can be eaten (just a snack) or saved for seeds, never sold to the kiosk', async () => {
    await give('alice', 'tomato', 2);
    await study('alice', 5);
    let garden = await call('alice', 'save_seeds', 'tomato');
    assert.equal(garden.me.inventory.tomato, 1);
    assert.equal(garden.me.inventory.tomato_seeds, 3);

    garden = await call('alice', 'eat', 'tomato');
    assert.equal(garden.me.inventory.tomato, undefined);
    assert.equal(garden.me.activity, null, 'eating leaves nothing for friends to see');
    await rejects(call('alice', 'eat', 'tomato'), /Not enough tomato/);
    await rejects(call('alice', 'eat', 'tomato_seeds'), /can't eat/);
    await rejects(call('alice', 'save_seeds', 'mug'), /no seeds/);
  });

  test('everyone has a fixed garden slot, in the order they joined', async () => {
    const garden = await call('bob', 'get_garden');
    assert.equal(garden.me.plot_slot, 1);
    assert.deepEqual(
      garden.neighbours.map((n) => [n.username, n.plot_slot]),
      [
        ['alice', 0],
        ['carol', 2],
      ]
    );
  });
});

describe('smoking', () => {
  test('uses a cigarette and shows for 5 minutes', async () => {
    await study('alice', 50); // 10 minute break
    await rejects(call('alice', 'smoke'), /Not enough cigarettes/);
    await setChips('alice', 50);
    await call('alice', 'buy', 'cigarette');
    let garden = await call('alice', 'smoke');
    assert.equal(garden.me.activity, 'smoking');
    assert.equal(garden.me.inventory.cigarette, 4);
    await rejects(call('alice', 'smoke'), /already having one/);

    // Friends see it on the board while it lasts.
    let board = await call('bob', 'get_friends_board');
    assert.equal(board.find((f) => f.username === 'alice').activity, 'smoking');
    await travel(6);
    board = await call('bob', 'get_friends_board');
    assert.equal(board.find((f) => f.username === 'alice').activity, null);
    garden = await call('alice', 'smoke');
    assert.equal(garden.me.inventory.cigarette, 3);

    // Sitting down to study puts it out.
    await travel(5);
    const me = await call('alice', 'start_session', 5);
    assert.equal(me.activity, null);
  });
});

describe('trades', () => {
  test('gifts and swaps between friends, with escrow', async () => {
    await give('alice', 'tomato', 3);
    await give('bob', 'carrot', 2);
    await study(['alice', 'bob'], 50);

    // A gift.
    let garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, null, null);
    assert.equal(garden.me.inventory.tomato, 2, 'gift is held in escrow');
    const gift = garden.trades[0];
    assert.equal(gift.incoming, false);
    assert.equal(gift.want_item, null);

    garden = await call('bob', 'get_garden');
    assert.equal(garden.trades.length, 1);
    assert.equal(garden.trades[0].incoming, true);
    garden = await call('bob', 'respond_trade', gift.id, true);
    assert.equal(garden.me.inventory.tomato, 1);
    assert.equal(garden.trades.length, 0);
    await rejects(call('bob', 'respond_trade', gift.id, true), /no longer open/);

    // A swap that bob can't afford stays open; declining returns the escrow.
    garden = await call('alice', 'offer_trade', 'bob', 'tomato', 2, 'carrot', 5);
    assert.equal(garden.me.inventory.tomato, undefined);
    const swap = garden.trades[0];
    await rejects(call('bob', 'respond_trade', swap.id, true), /Not enough carrot/);
    assert.equal((await call('bob', 'get_garden')).trades.length, 1);
    await call('bob', 'respond_trade', swap.id, false);
    assert.equal((await call('alice', 'get_garden')).me.inventory.tomato, 2);

    // A swap that goes through.
    garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, 'carrot', 2);
    garden = await call('bob', 'respond_trade', garden.trades[0].id, true);
    assert.equal(garden.me.inventory.carrot, undefined);
    assert.equal(garden.me.inventory.tomato, 2);
    assert.equal((await call('alice', 'get_garden')).me.inventory.carrot, 2);

    // Withdrawing returns the escrow, and only the sender can do it.
    garden = await call('alice', 'offer_trade', 'bob', 'carrot', 1, 'tomato', 1);
    const offer = garden.trades[0];
    await rejects(call('bob', 'cancel_trade', offer.id), /no longer open/);
    garden = await call('alice', 'cancel_trade', offer.id);
    assert.equal(garden.me.inventory.carrot, 2);
    assert.equal(garden.trades.length, 0);
  });

  test('are friends-only and limited to produce, seeds and cigarettes', async () => {
    await give('alice', 'tomato', 5);
    await give('alice', 'mug', 1);
    await study('alice', 50);
    await rejects(
      call('alice', 'offer_trade', 'carol', 'tomato', 1, null, null),
      /only trade with friends/
    );
    await rejects(
      call('alice', 'offer_trade', 'alice', 'tomato', 1, null, null),
      /only trade with friends/
    );
    await rejects(call('alice', 'offer_trade', 'bob', 'mug', 1, null, null), /can't trade that/);
    await rejects(
      call('alice', 'offer_trade', 'bob', 'tomato', 1, 'hatchback', 1),
      /can't ask for that/
    );
    await rejects(call('alice', 'offer_trade', 'bob', 'tomato', 0, null, null), /at least one/);
    await rejects(
      call('alice', 'offer_trade', 'bob', 'tomato', 9, null, null),
      /Not enough tomato/
    );
    // Zero wanted is a gift.
    const garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, 'carrot', 0);
    assert.equal(garden.trades[0].want_item, null);
  });

  test('need a break, but withdrawing an offer does not', async () => {
    await give('alice', 'tomato', 1);
    await study('alice', 5);
    const garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, null, null);
    await rejects(call('bob', 'respond_trade', garden.trades[0].id, true), /on a break/);
    await call('alice', 'go_home');
    const after = await call('alice', 'cancel_trade', garden.trades[0].id);
    assert.equal(after.me.inventory.tomato, 1);
  });
});

describe('the market', () => {
  test('stalls hold what you put out, and you can take it back', async () => {
    await give('alice', 'tomato', 5);
    await study('alice', 25);
    let garden = await call('alice', 'list_item', 'tomato', 3, 4);
    assert.equal(garden.me.inventory.tomato, 2);
    assert.deepEqual(
      garden.me.stall.map((l) => [l.item, l.qty, l.price]),
      [['tomato', 3, 4]]
    );
    // Same item at the same price stacks up.
    garden = await call('alice', 'list_item', 'tomato', 1, 4);
    assert.deepEqual(
      garden.me.stall.map((l) => [l.qty, l.price]),
      [[4, 4]]
    );
    // Friends can see the stall.
    const bobs = await call('bob', 'get_garden');
    assert.equal(bobs.neighbours.find((n) => n.username === 'alice').stall[0].qty, 4);

    garden = await call('alice', 'unlist', garden.me.stall[0].id);
    assert.deepEqual(garden.me.stall, []);
    assert.equal(garden.me.inventory.tomato, 5);
  });

  test('friends standing in the garden buy from each other with chips', async () => {
    await give('alice', 'strawberry', 4);
    await setChips('bob', 30);
    await study(['alice', 'bob'], 25);
    const aliceChips = (await call('alice', 'get_me')).chips;
    const bobChips = (await call('bob', 'get_me')).chips;
    const listing = (await call('alice', 'list_item', 'strawberry', 4, 6)).me.stall[0];

    let garden = await call('bob', 'buy_listing', listing.id, 3);
    assert.equal(garden.me.inventory.strawberry, 3);
    assert.equal(garden.me.chips, bobChips - 18);
    assert.equal((await call('alice', 'get_me')).chips, aliceChips + 18);
    assert.equal(garden.neighbours.find((n) => n.username === 'alice').stall[0].qty, 1);

    // Buying the last one clears it from the stall.
    garden = await call('bob', 'buy_listing', listing.id, 1);
    assert.deepEqual(garden.neighbours.find((n) => n.username === 'alice').stall, []);
    await rejects(call('bob', 'buy_listing', listing.id, 1), /sold out/);
  });

  test('buying needs both of you in the garden, friendship, chips and stock', async () => {
    await give('alice', 'carrot', 5);
    await give('bob', 'radish', 1);
    await setChips('carol', 100);
    await study(['alice', 'bob', 'carol'], 25);
    const listing = (await call('alice', 'list_item', 'carrot', 5, 20)).me.stall[0];

    await rejects(call('alice', 'buy_listing', listing.id, 1), /your own stall/);
    await rejects(call('carol', 'buy_listing', listing.id, 1), /only buy from friends/);
    await rejects(call('bob', 'buy_listing', listing.id, 6), /aren't that many/);
    await setChips('bob', 30);
    await rejects(call('bob', 'buy_listing', listing.id, 2), /Not enough chips/);

    await call('alice', 'go_home');
    await rejects(call('bob', 'buy_listing', listing.id, 1), /stall is closed/);
    await call('bob', 'go_home');
    await rejects(call('bob', 'buy_listing', listing.id, 1), /on a break/);
  });

  test('stalls only take produce, seeds and cigarettes, at 1 to 999 chips', async () => {
    await give('alice', 'mug', 1);
    await give('alice', 'tomato', 20);
    await study('alice', 25);
    await rejects(call('alice', 'list_item', 'mug', 1, 5), /can't sell that/);
    await rejects(call('alice', 'list_item', 'tomato', 0, 5), /at least one/);
    await rejects(call('alice', 'list_item', 'tomato', 1, 0), /1 to 999/);
    await rejects(call('alice', 'list_item', 'tomato', 1, 1000), /1 to 999/);
    await rejects(call('alice', 'list_item', 'tomato', 21, 5), /Not enough tomato/);
    for (let price = 1; price <= 12; price++) await call('alice', 'list_item', 'tomato', 1, price);
    await rejects(call('alice', 'list_item', 'tomato', 1, 13), /stall is full/);
    // Adding to a price already on the stall still works.
    await call('alice', 'list_item', 'tomato', 1, 12);
  });
});

describe('the friends board and garden', () => {
  test('the board shows status, vehicle and desk things, but never chips', async () => {
    await setChips('bob', 200);
    await call('bob', 'buy', 'lamp');
    await call('bob', 'buy', 'mug');
    await call('bob', 'buy', 'bike');
    await call('bob', 'start_session', 30);

    const board = await call('alice', 'get_friends_board');
    assert.deepEqual(
      board.map((f) => f.username),
      ['bob']
    );
    const bob = board[0];
    assert.equal(bob.status, 'focused');
    assert.ok(bob.ends_at);
    assert.equal(bob.vehicle, 'bike');
    assert.deepEqual(bob.desk_items, ['mug', 'lamp']);
    assert.ok(bob.desk >= 0);
    assert.equal('chips' in bob, false);
    assert.equal('points' in bob, false);

    // carol is bob's friend but not alice's.
    const bobsBoard = await call('bob', 'get_friends_board');
    assert.deepEqual(bobsBoard.map((f) => f.username).sort(), ['alice', 'carol']);
  });

  test("the garden shows your friends' plots and who is on a break", async () => {
    await give('bob', 'carrot_seeds', 1);
    await study('bob', 25);
    await call('bob', 'plant', 2, 'carrot_seeds');

    const garden = await call('alice', 'get_garden');
    assert.equal(garden.me.status, 'absent');
    assert.equal(garden.neighbours.length, 1);
    const bob = garden.neighbours[0];
    assert.equal(bob.username, 'bob');
    assert.equal(bob.status, 'on_break');
    assert.ok(bob.break_ends_at);
    assert.deepEqual(
      bob.plots.map((p) => [p.bed, p.crop]),
      [[2, 'carrot']]
    );
    assert.equal('inventory' in bob, false);
    assert.equal('chips' in bob, false);
  });

  test('a friend whose timer ran out is finalized when you look at the garden', async () => {
    await call('bob', 'start_session', 10);
    await travel(11);
    const garden = await call('alice', 'get_garden');
    assert.equal(garden.neighbours[0].status, 'on_break');
    const [{ chips }] = await q('select chips from public.profiles where username = $1', ['bob']);
    assertPayout(chips, 10);
  });
});

describe('invites', () => {
  test('invitees join as friends of whoever invited them', async () => {
    const invite = await call('carol', 'create_invite');
    assert.match(invite.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    // Codes are typed loosely: lower case and dashes are fine.
    const typed = `${invite.code.slice(0, 4).toLowerCase()}-${invite.code.slice(4)}`;
    assert.deepEqual(await call('anon', 'check_signup', typed, 'dave'), {
      ok: true,
      from: 'Carol',
    });

    await signUp('dave', typed, { name: 'Dave' });
    const dave = await call('dave', 'get_me');
    assert.equal(dave.username, 'dave');
    assert.equal(dave.display_name, 'Dave');
    assert.deepEqual(
      (await call('dave', 'get_friends_board')).map((f) => f.username),
      ['carol']
    );
    const invites = await call('carol', 'get_invites');
    assert.equal(invites.find((i) => i.code === invite.code).used_by, 'Dave');
    assert.equal((await call('dave', 'get_garden')).me.plot_slot, 3);
  });

  test('sign-up fails without a valid, unused, unexpired invite', async () => {
    await rejects(signUp('eve', null), /invite-only/);
    await rejects(signUp('eve', 'NOTACODE'), /invite-only/);

    const used = await q(`select code from public.invites where used_by is not null limit 1`);
    await rejects(signUp('eve', used[0].code), /invite-only/);

    const old = await call('alice', 'create_invite');
    await travel(60 * 24 * 15);
    await rejects(signUp('eve', old.code), /invite-only/);

    const fresh = await call('alice', 'create_invite');
    await rejects(signUp('eve', fresh.code, { email: 'someone@else.test' }), /must be/);
    assert.equal(
      (await q(`select count(*)::int as n from public.profiles where username = 'eve'`))[0].n,
      0
    );
  });

  test('check_signup explains what is wrong, before anyone signs up', async () => {
    const { code } = await call('alice', 'create_invite');
    assert.match((await call('anon', 'check_signup', 'NOPE', 'eve')).reason, /isn't valid/);
    assert.match((await call('anon', 'check_signup', code, 'E!')).reason, /3 to 20/);
    assert.match((await call('anon', 'check_signup', code, 'bob')).reason, /taken/);
    assert.equal((await call('anon', 'check_signup', code, 'eve')).ok, true);
  });

  test('five unused invites at a time', async () => {
    await q(`delete from public.invites where created_by = $1 and used_by is null`, [ids.bob]);
    for (let i = 0; i < 5; i++) await call('bob', 'create_invite');
    await rejects(call('bob', 'create_invite'), /5 unused invites/);
  });
});

describe('testing tools', () => {
  test('are off unless the account is marked as a tester in the SQL editor', async () => {
    assert.equal((await call('alice', 'get_me')).tester, false);
    await rejects(call('alice', 'dev_chips', 500), /testing tools are off/);
    await rejects(call('alice', 'dev_skip', 30), /testing tools are off/);
    await rejects(call('alice', 'dev_item', 'tomato_seeds', 3), /testing tools are off/);
    await rejects(call('alice', 'dev_ripen'), /testing tools are off/);
  });

  test('give chips and items, and ripen crops', async () => {
    await q(`update public.profiles set tester = true where id = $1`, [ids.alice]);
    let me = await call('alice', 'dev_chips', 500);
    assert.equal(me.tester, true);
    assert.equal(me.chips, 500);
    me = await call('alice', 'dev_chips', -800);
    assert.equal(me.chips, 0, 'never below 0');

    me = await call('alice', 'dev_item', 'tomato_seeds', 3);
    assert.equal(me.inventory.tomato_seeds, 3);
    me = await call('alice', 'dev_item', 'hatchback', 5);
    assert.equal(me.inventory.hatchback, 1, 'vehicles are one-offs');
    assert.equal(me.vehicle, 'hatchback');
    await rejects(call('alice', 'dev_item', 'unicorn', 1), /no item called unicorn/);

    await study('alice', 5);
    await call('alice', 'plant', 0, 'tomato_seeds');
    me = await call('alice', 'dev_ripen');
    assert.deepEqual(
      me.ripe.map((r) => [r.bed, r.crop]),
      [[0, 'tomato']]
    );
    const garden = await call('alice', 'harvest', 0);
    assert.equal(garden.me.inventory.tomato, 4);
  });

  test('skipping ahead finishes a session, runs down the break, and ages crops', async () => {
    await q(`update public.profiles set tester = true where id = $1`, [ids.alice]);
    await call('alice', 'start_session', 50);
    let me = await call('alice', 'dev_skip', 49);
    assert.equal(me.status, 'focused');
    me = await call('alice', 'dev_skip', 2);
    assert.equal(me.status, 'on_break');
    assertPayout(me.chips, 50);
    assert.ok(Date.parse(me.break_ends_at) - Date.now() < 9 * 60_000, 'a minute of break gone');

    me = await call('alice', 'dev_skip', 10);
    assert.equal(me.status, 'idle');
    me = await call('alice', 'dev_skip', 60);
    assert.equal(me.status, 'absent');

    // A ripe crop skipped past its two days withers.
    await study('alice', 5);
    await call('alice', 'dev_item', 'radish_seeds', 1);
    await call('alice', 'plant', 0, 'radish_seeds');
    await call('alice', 'dev_ripen');
    await call('alice', 'dev_skip', 2 * 24 * 60);
    const [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.equal(plot.withered, true);
    await rejects(call('alice', 'dev_skip', 0), /1 minute to 2 weeks/);
  });
});

describe('access', () => {
  test("row level security: read your own data and your friends', write nothing", async () => {
    await give('bob', 'tomato', 1);
    await give('bob', 'radish_seeds', 1);
    await give('alice', 'mug', 1);
    await give('carol', 'radish_seeds', 1);
    await give('carol', 'carrot', 1);
    await study(['bob', 'carol'], 5);
    await call('carol', 'plant', 0, 'radish_seeds');
    await call('bob', 'plant', 0, 'radish_seeds');
    await call('bob', 'list_item', 'tomato', 1, 3);
    await call('carol', 'list_item', 'carrot', 1, 3);

    const inv = await asUser('alice', 'select item from public.inventory');
    assert.deepEqual(
      inv.map((r) => r.item),
      ['mug']
    );

    const plots = await asUser(
      'alice',
      'select p.username from public.plots b join public.profiles p on p.id = b.user_id'
    );
    assert.deepEqual(
      plots.map((r) => r.username),
      ['bob']
    );

    const stalls = await asUser('alice', 'select item from public.listings');
    assert.deepEqual(
      stalls.map((r) => r.item),
      ['tomato']
    );

    const invites = await asUser('alice', 'select created_by from public.invites');
    assert.ok(invites.every((r) => r.created_by === ids.alice));

    const items = await asUser('alice', 'select count(*)::int as n from public.items');
    assert.ok(items[0].n > 20);

    const updated = await asUser(
      'alice',
      'update public.profiles set chips = 9999 where true returning id'
    );
    assert.equal(updated.length, 0);
    await rejects(
      asUser(
        'alice',
        `insert into public.inventory (user_id, item, qty) values ($1, 'bonsai', 1)`,
        [ids.alice]
      ),
      /row-level security/
    );
    await rejects(
      asUser('alice', `insert into public.invites (code) values ('FREEPASS')`),
      /row-level security/
    );
    await rejects(
      asUser('alice', 'select private.status_of($1)', [ids.alice]),
      /permission denied/
    );
  });

  test('anonymous callers can only check an invite', async () => {
    for (const fn of [
      'get_garden',
      'get_shop',
      'water',
      'smoke',
      'go_home',
      'arrive',
      'create_invite',
    ]) {
      await rejects(call('anon', fn), /permission denied/);
    }
    assert.equal((await call('anon', 'check_signup', 'X', 'y')).ok, false);
  });

  test('garden chat: hear yourself and friends, speak only on your own channel', async () => {
    for (const topic of ['garden:alice', 'garden:bob', 'garden:carol']) {
      await q(
        `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'say')`,
        [topic]
      );
    }
    await q(
      `insert into realtime.messages (topic, extension, event) values ('garden:bob', 'presence', 'x')`
    );

    const hears = async (user, topic) =>
      (await asUser(user, 'select count(*)::int as n from realtime.messages', [], topic))[0].n > 0;
    assert.equal(await hears('alice', 'garden:alice'), true);
    assert.equal(await hears('alice', 'garden:bob'), true);
    assert.equal(await hears('alice', 'garden:carol'), false, 'not friends');
    assert.equal(await hears('carol', 'garden:bob'), true);
    assert.equal(await hears('alice', 'office:bob'), false);

    const speak = (user, topic) =>
      asUser(
        user,
        `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'say')`,
        [topic],
        topic
      );
    await speak('alice', 'garden:alice');
    await rejects(speak('alice', 'garden:bob'), /row-level security/);
    await rejects(speak('alice', 'garden:carol'), /row-level security/);
  });
});
