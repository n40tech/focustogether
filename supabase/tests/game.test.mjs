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
import { after, before, beforeEach, test } from 'node:test';
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

/** Moves every stored timestamp back, which is the same as `minutes` passing. */
async function travel(minutes) {
  const m = `make_interval(mins => ${Number(minutes)})`;
  await q(`update public.sessions set started_at = started_at - ${m}, ended_at = ended_at - ${m}`);
  await q(
    `update public.profiles set went_home_at = went_home_at - ${m}, activity_until = activity_until - ${m}`
  );
  await q(`update public.plots set planted_at = planted_at - ${m}, watered_at = watered_at - ${m}`);
  await q(`update public.trades set created_at = created_at - ${m}, closed_at = closed_at - ${m}`);
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

  for (const name of ['alice', 'bob', 'carol']) {
    const [u] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${name}@focus.test`,
    ]);
    ids[name] = u.id;
    await q(`insert into public.profiles (id, username, display_name) values ($1, $2, $3)`, [
      u.id,
      name,
      name[0].toUpperCase() + name.slice(1),
    ]);
  }
  // alice <-> bob <-> carol, but alice and carol aren't friends.
  await call('alice', 'add_friend', 'bob');
  await call('bob', 'add_friend', 'carol');
});

beforeEach(async () => {
  await q('truncate public.sessions, public.inventory, public.plots, public.trades');
  await q(
    'update public.profiles set chips = 0, vehicle = null, went_home_at = null, activity = null, activity_until = null'
  );
});

after(async () => {
  await db.end();
});

test('a new player is absent with no chips, vehicle or inventory', async () => {
  const me = await call('alice', 'get_me');
  assert.equal(me.status, 'absent');
  assert.equal(me.chips, 0);
  assert.equal(me.vehicle, null);
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

test('completing a session pays 1 chip per minute and earns a break of 1 min per 5', async () => {
  const me = await study('alice', 25);
  assert.equal(me.status, 'on_break');
  assert.equal(me.chips, 25);
  assert.equal(me.active_session, null);
  assert.equal(me.last_completed.duration_min, 25);
  assert.equal(me.last_completed.break_min, 5);
  const breakMs = Date.parse(me.break_ends_at) - Date.parse(me.last_completed.ended_at);
  assert.equal(breakMs, 5 * 60_000);

  // Finalizing again must not pay twice.
  assert.equal((await call('alice', 'get_me')).chips, 25);
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

test('after the break you are idle for 10 minutes, then absent', async () => {
  await study('alice', 25); // 5 minute break
  await travel(4);
  assert.equal((await call('alice', 'get_me')).status, 'on_break');
  await travel(2);
  assert.equal((await call('alice', 'get_me')).status, 'idle');
  await travel(8); // 14 minutes after the session ended
  assert.equal((await call('alice', 'get_me')).status, 'idle');
  await travel(2);
  assert.equal((await call('alice', 'get_me')).status, 'absent');
});

test('going home ends the break at once', async () => {
  await study('alice', 25);
  const me = await call('alice', 'go_home');
  assert.equal(me.status, 'absent');
  await rejects(call('alice', 'water'), /on a break/);
});

test('a new session after going home counts again', async () => {
  await study('alice', 10);
  await call('alice', 'go_home');
  await travel(1);
  const me = await study('alice', 10);
  assert.equal(me.status, 'on_break');
  assert.equal(me.chips, 20);
});

test('giving up pays nothing, earns no break and leaves you idle', async () => {
  await call('alice', 'start_session', 50);
  await travel(20);
  const me = await call('alice', 'cancel_session');
  assert.equal(me.chips, 0);
  assert.equal(me.status, 'idle');
  assert.equal(me.break_ends_at, null);
  await rejects(call('alice', 'water'), /on a break/);
  await travel(11);
  assert.equal((await call('alice', 'get_me')).status, 'absent');
});

test('the kiosk sells packs, one-off desk items and vehicles', async () => {
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

test('produce can be eaten or saved for seeds, never sold', async () => {
  await give('alice', 'tomato', 2);
  await study('alice', 5);
  let garden = await call('alice', 'save_seeds', 'tomato');
  assert.equal(garden.me.inventory.tomato, 1);
  assert.equal(garden.me.inventory.tomato_seeds, 3);

  garden = await call('alice', 'eat', 'tomato');
  assert.equal(garden.me.inventory.tomato, undefined);
  assert.equal(garden.me.activity, 'eating');
  await rejects(call('alice', 'eat', 'tomato'), /Not enough tomato/);
  await rejects(call('alice', 'eat', 'tomato_seeds'), /can't eat/);
  await rejects(call('alice', 'save_seeds', 'mug'), /no seeds/);
});

test('smoking uses a cigarette and shows for 5 minutes', async () => {
  await study('alice', 50); // 10 minute break
  await rejects(call('alice', 'smoke'), /Not enough cigarettes/);
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

test('gifts and trades between friends, with escrow', async () => {
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

test('trades are friends-only and limited to produce, seeds and cigarettes', async () => {
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
  await rejects(call('alice', 'offer_trade', 'bob', 'tomato', 9, null, null), /Not enough tomato/);
  // Zero wanted is a gift.
  const garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, 'carrot', 0);
  assert.equal(garden.trades[0].want_item, null);
});

test('trading needs a break, but withdrawing an offer does not', async () => {
  await give('alice', 'tomato', 1);
  await study('alice', 5);
  const garden = await call('alice', 'offer_trade', 'bob', 'tomato', 1, null, null);
  await rejects(call('bob', 'respond_trade', garden.trades[0].id, true), /on a break/);
  await call('alice', 'go_home');
  const after = await call('alice', 'cancel_trade', garden.trades[0].id);
  assert.equal(after.me.inventory.tomato, 1);
});

test('the friends board shows status, vehicle and desk, but never chips', async () => {
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
  assert.deepEqual(bob.desk, ['mug', 'lamp']);
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
});

test('a friend whose timer ran out is finalized when you look at the garden', async () => {
  await call('bob', 'start_session', 10);
  await travel(11);
  const garden = await call('alice', 'get_garden');
  assert.equal(garden.neighbours[0].status, 'on_break');
  assert.equal(
    (await q('select chips from public.profiles where username = $1', ['bob']))[0].chips,
    10
  );
});

test("row level security: read your own data and your friends', write nothing", async () => {
  await give('bob', 'tomato', 1);
  await give('alice', 'mug', 1);
  await give('carol', 'radish_seeds', 1);
  await study('carol', 5);
  await call('carol', 'plant', 0, 'radish_seeds');
  await study('bob', 5);
  await give('bob', 'radish_seeds', 1);
  await call('bob', 'plant', 0, 'radish_seeds');

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

  const items = await asUser('alice', 'select count(*)::int as n from public.items');
  assert.ok(items[0].n > 20);

  const updated = await asUser(
    'alice',
    'update public.profiles set chips = 9999 where true returning id'
  );
  assert.equal(updated.length, 0);
  await rejects(
    asUser('alice', `insert into public.inventory (user_id, item, qty) values ($1, 'bonsai', 1)`, [
      ids.alice,
    ]),
    /row-level security/
  );
  await rejects(asUser('alice', 'select private.status_of($1)', [ids.alice]), /permission denied/);
});

test('anonymous callers cannot use the game API', async () => {
  for (const fn of ['get_garden', 'get_shop', 'water', 'smoke', 'go_home']) {
    await rejects(call('anon', fn), /permission denied/);
  }
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
