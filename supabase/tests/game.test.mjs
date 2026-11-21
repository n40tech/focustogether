// Scenario tests for supabase/migrations: they run on a plain Postgres with
// supabase-stubs.sql standing in for Supabase's auth and Realtime schemas.
//
//   npm run test:db    with the local Supabase running (npx supabase start)
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
//
// The server in DATABASE_URL (by default the local Supabase's) is only used
// to create a scratch database, focus_test, which is dropped and rebuilt from
// the migrations on every run. Nothing else on it is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, '..', 'migrations');
const adminUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
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

/** Calls public.<fn>(...args) as the service role (an Edge Function), returning rows. */
async function asService(fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  await db.query('begin');
  try {
    await db.query('set local role service_role');
    const { rows } = await db.query(`select * from public.${fn}(${ph})`, args);
    await db.query('commit');
    return rows;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

/** What Supabase Auth does on sign-up: insert the user with the form's metadata. */
async function signUp(username, invite, { email, name, contact, born } = {}) {
  const [u] = await q(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [
      email ?? `${username}@focus.test`,
      {
        invite,
        username,
        display_name: name ?? username[0].toUpperCase() + username.slice(1),
        contact_email:
          contact === undefined
            ? `${username.normalize('NFD').replace(/[^a-z0-9_]/g, '')}@studymail.co.uk`
            : contact,
        born: born === undefined ? '1999-04-01' : born,
      },
    ]
  );
  ids[username] = u.id;
  return u.id;
}

/** Moves every stored timestamp back, which is the same as `minutes` passing (fractions too). */
async function travel(minutes) {
  const m = `make_interval(secs => ${Number(minutes) * 60})`;
  await q(
    `update public.sessions set started_at = started_at - ${m}, ended_at = ended_at - ${m},
       left_at = left_at - ${m}`
  );
  await q(
    `update public.profiles set went_home_at = went_home_at - ${m}, activity_until = activity_until - ${m},
       arrived_at = arrived_at - ${m}, seen_at = seen_at - ${m}, insured_until = insured_until - ${m},
       bumped_at = bumped_at - ${m}`
  );
  await q(`update public.crashes set at = at - ${m}, settled_at = settled_at - ${m}`);
  await q(
    `update public.plots set planted_at = planted_at - ${m}, watered_at = watered_at - ${m},
       settled_at = settled_at - ${m}`
  );
  await q(`update public.trades set created_at = created_at - ${m}, closed_at = closed_at - ${m}`);
  await q(`update public.invites set expires_at = expires_at - ${m}`);
  await q(`update public.letters set sent_at = sent_at - ${m}, read_at = read_at - ${m}`);
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

/** Makes two players friends: one asks, and the other says yes. */
async function befriend(a, b) {
  await call(a, 'add_friend', b);
  await call(b, 'answer_friend_request', a, true);
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.match(e.message, pattern);
    return true;
  });
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function assertNear(actual, expected, tolerance, what = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what} ${actual} is not within ${tolerance} of ${expected}`
  );
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
    `truncate public.inventory, public.plots, public.trades, public.listings, public.letters,
       public.friend_requests, public.desk_layout, public.push_subscriptions, public.crashes`
  );
  // Invites can point at a session, so these can't be truncated.
  await q('delete from public.sessions');
  await q(
    `update public.profiles set chips = 0, vehicle = null, went_home_at = null, activity = null,
       activity_until = null, arrived_at = null, desk = null, tester = false, place = null,
       seen_at = null, tips = '{}', hard_mode = false, parked = null, vehicle_health = 100,
       insured_until = null, bumped_at = null`
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

  test('arriving, then closing the app for 15 minutes, counts as going home', async () => {
    await call('alice', 'arrive');
    await travel(16);
    const me = await call('alice', 'get_me');
    assert.equal(me.status, 'absent');
    assert.equal(me.desk, null);
  });

  test('after a session you stay at your desk until you get up and go somewhere', async () => {
    const seen = async () => {
      const a = (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice');
      return [a.status, a.place];
    };
    await call('alice', 'set_place', 'office');
    assert.deepEqual(await seen(), ['idle', 'office']);
    await study('alice', 25);
    assert.deepEqual(await seen(), ['on_break', 'office'], 'still at the desk after the session');

    let me = await call('alice', 'set_place', 'garden');
    assert.equal(me.place, 'garden');
    assert.deepEqual(await seen(), ['on_break', 'garden']);
    await call('alice', 'set_place', 'outside');
    assert.deepEqual(await seen(), ['on_break', 'outside']);

    me = await call('alice', 'go_home');
    assert.deepEqual([me.status, me.place, me.desk], ['absent', null, null]);
    assert.deepEqual(await seen(), ['absent', null]);
    await rejects(call('alice', 'set_place', 'kitchen'), /nowhere called kitchen/);
  });

  test("mid-session you're at your desk, and when you're not at work you're nowhere", async () => {
    let me = await call('alice', 'set_place', 'garden');
    assert.deepEqual([me.status, me.place], ['absent', null]);
    me = await call('alice', 'start_session', 25);
    assert.equal(me.place, 'office');
    me = await call('alice', 'set_place', 'garden');
    assert.equal(me.place, 'office');
  });

  test('with your app open at your desk you stay at work; closed, you drift off as before', async () => {
    await call('alice', 'set_place', 'office');
    // The app checks in every few seconds while it's open.
    for (let minute = 1; minute <= 20; minute++) {
      await travel(1);
      assert.equal((await call('alice', 'get_me')).status, 'idle', `after ${minute} min`);
    }
    // Closed: nothing checks in, and the 15 minutes after arriving are long gone.
    await travel(3);
    let me = await call('alice', 'get_me');
    assert.deepEqual([me.status, me.desk], ['absent', null]);
    // Opening the app again doesn't put you back at your desk.
    me = await call('alice', 'get_me');
    assert.equal(me.status, 'absent');
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

describe('leaving the page', () => {
  const running = async (user) => (await call(user, 'get_me')).active_session;

  test("by default, leaving the page doesn't stop a session", async () => {
    let me = await call('alice', 'start_session', 25, 'tab-a');
    assert.equal(me.hard_mode, false);
    assert.equal(me.active_session.hard, false);
    const { id } = me.active_session;
    await call('alice', 'leave_page', id, 'tab-a');
    await travel(10);
    assert.equal((await call('alice', 'get_me')).status, 'focused');
    me = await call('alice', 'back_to_page', id, 'tab-a', 600);
    assert.equal(me.status, 'focused');
    await travel(15);
    me = await call('alice', 'back_to_page', id, 'tab-a', 900);
    assert.equal(me.status, 'on_break', 'nor take it back afterwards');
    assertPayout(me.chips, 25);
  });

  test('hard mode is kept per account, and each session keeps the mode it started in', async () => {
    let me = await call('alice', 'set_hard_mode', true);
    assert.equal(me.hard_mode, true);
    me = await call('alice', 'start_session', 25, 'tab-a');
    assert.equal(me.active_session.hard, true);
    me = await call('alice', 'set_hard_mode', false);
    assert.equal(me.active_session.hard, true, 'changing it mid-session changes nothing');
    await call('alice', 'cancel_session');

    // Joining a friend uses your own mode, not theirs.
    await call('bob', 'set_hard_mode', true);
    await call('bob', 'start_session', 30);
    me = await call('alice', 'join_session', 'bob', 'tab-a');
    assert.equal(me.active_session.hard, false);
  });

  describe('in hard mode', () => {
    beforeEach(async () => {
      for (const user of ['alice', 'bob']) await call(user, 'set_hard_mode', true);
    });

    test('more than 10 seconds away stops the session: no chips, no break', async () => {
      await call('alice', 'start_session', 25, 'tab-a');
      const { id, device } = await running('alice');
      assert.equal(device, 'tab-a');
      await travel(5);
      await call('alice', 'leave_page', id, 'tab-a');
      await travel(11 / 60);

      let me = await call('alice', 'get_me');
      assert.equal(me.status, 'idle');
      assert.equal(me.active_session, null);
      assert.equal(me.break_ends_at, null);
      assert.equal(me.left_session.id, id);
      assertNear(
        Date.parse(me.left_session.left_at) - Date.parse(me.left_session.started_at),
        5 * MIN,
        2000,
        'left 5 minutes in'
      );
      const board = await call('bob', 'get_friends_board');
      assert.equal(board.find((f) => f.username === 'alice').status, 'idle');

      // Coming back doesn't bring it back, and it never pays.
      me = await call('alice', 'back_to_page', id, 'tab-a', 30);
      assert.equal(me.active_session, null);
      await travel(30);
      assert.equal((await call('alice', 'get_me')).chips, 0);
      await travel(12 * 60);
      assert.equal((await call('alice', 'get_me')).left_session, null, 'forgotten by the next day');
      await travel(-12 * 60);
      me = await call('alice', 'start_session', 5, 'tab-a');
      assert.equal(me.left_session, null, 'forgotten once you start another');
    });

    test('back within 10 seconds, the session carries on', async () => {
      await call('alice', 'start_session', 25, 'tab-a');
      const { id } = await running('alice');
      await call('alice', 'leave_page', id, 'tab-a');
      await travel(6 / 60);
      let me = await call('alice', 'back_to_page', id, 'tab-a', 6);
      assert.equal(me.status, 'focused');
      await travel(30 / 60);
      assert.equal((await call('alice', 'get_me')).status, 'focused');
      await travel(25);
      me = await call('alice', 'get_me');
      assert.equal(me.status, 'on_break');
      assertPayout(me.chips, 25);
    });

    test('only the page the session started on counts', async () => {
      await call('alice', 'start_session', 25, 'laptop');
      const { id } = await running('alice');
      await call('alice', 'leave_page', id, 'phone');
      await travel(1);
      assert.equal((await call('alice', 'get_me')).status, 'focused');
      await call('alice', 'back_to_page', id, 'phone', 600);
      assert.equal((await call('alice', 'get_me')).status, 'focused');
      // Nor can anyone else stop it.
      await call('bob', 'leave_page', id, 'laptop');
      await travel(1);
      assert.equal((await call('alice', 'get_me')).status, 'focused');
    });

    test('leaving in the last 10 seconds still pays', async () => {
      await call('alice', 'start_session', 25, 'tab-a');
      const { id } = await running('alice');
      await travel(25 - 5 / 60);
      await call('alice', 'leave_page', id, 'tab-a');
      await travel(1);
      const me = await call('alice', 'get_me');
      assert.equal(me.status, 'on_break');
      assertPayout(me.chips, 25);
    });

    test("the app's own count of time away stops it, even when word of leaving never came", async () => {
      // Away (with no signal) since a minute before the end: bob's board
      // finishes the session and pays it meanwhile, and coming back takes it back.
      await call('alice', 'start_session', 25, 'tab-a');
      const first = await running('alice');
      await travel(27);
      await call('bob', 'get_friends_board');
      const [{ chips }] = await q('select chips from public.profiles where id = $1', [ids.alice]);
      assertPayout(chips, 25);
      let me = await call('alice', 'back_to_page', first.id, 'tab-a', 3 * 60);
      assert.equal(me.chips, 0, 'taken back');
      assert.equal(me.status, 'idle');
      assert.equal(me.last_completed, null);
      assert.equal(me.left_session.id, first.id);

      // Still running when you come back: it stops then.
      await call('alice', 'start_session', 25, 'tab-a');
      const second = await running('alice');
      await travel(2);
      me = await call('alice', 'back_to_page', second.id, 'tab-a', 60);
      assert.equal(me.active_session, null);
      assert.equal(me.left_session.id, second.id);
    });
  });
});

describe('a first day', () => {
  test('your first session can be skipped, as 25 minutes at most', async () => {
    let me = await call('alice', 'get_me');
    assert.equal(me.sessions_done, 0);
    await rejects(call('alice', 'skip_first_session'), /No session is running/);

    // Giving up doesn't use up the skip.
    await call('alice', 'start_session', 10, 'tab-a');
    await call('alice', 'cancel_session');
    await call('alice', 'start_session', 60, 'tab-a');
    me = await call('alice', 'skip_first_session');
    assert.equal(me.status, 'on_break');
    assert.equal(me.sessions_done, 1);
    assert.equal(me.last_completed.duration_min, 25);
    assert.equal(me.last_completed.break_min, 5);
    assertPayout(me.chips, 25);
    // A skipped session wasn't studied.
    assert.equal(me.sessions_studied, 0);

    await travel(10);
    await call('alice', 'start_session', 10, 'tab-a');
    await rejects(call('alice', 'skip_first_session'), /Only your first session/);
    await travel(10);
    me = await call('alice', 'get_me');
    assert.equal(me.sessions_done, 2);
    assert.equal(me.sessions_studied, 1);
  });

  test('tips are remembered once each, and can be brought back', async () => {
    assert.deepEqual((await call('alice', 'get_me')).tips, []);
    let me = await call('alice', 'done_tip', 'welcome');
    assert.deepEqual(me.tips, ['welcome']);
    me = await call('alice', 'done_tip', 'welcome');
    me = await call('alice', 'done_tip', 'plant');
    assert.deepEqual(me.tips, ['welcome', 'plant']);
    await rejects(call('alice', 'done_tip', 'Bad Tip!'), /no tip called/);
    me = await call('alice', 'reset_tips');
    assert.deepEqual(me.tips, []);
  });
});

describe('the post box', () => {
  test('letters go to friends and wait in the post box until picked up', async () => {
    await rejects(call('alice', 'send_letter', 'bob', 'Hello'), /on a break/);
    await study('alice', 25);
    await rejects(call('alice', 'send_letter', 'carol', 'Hi'), /only write to friends/);
    await rejects(call('alice', 'send_letter', 'bob', '   '), /Write something/);
    await rejects(call('alice', 'send_letter', 'bob', 'x'.repeat(1001)), /up to 1000/);
    let post = await call('alice', 'send_letter', 'Bob ', '  Fancy a coffee at 3?  ');
    assert.deepEqual(
      post.sent.map((l) => [l.to, l.to_name, l.body, l.read_at]),
      [['bob', 'Bob', 'Fancy a coffee at 3?', null]]
    );

    // Bob hears there's post wherever he is, and picks it up from the post box.
    assert.equal((await call('bob', 'get_me')).letters, 1);
    post = await call('bob', 'get_post');
    assert.equal(post.waiting, 1);
    assert.deepEqual(
      post.letters.map((l) => [l.from, l.from_name, l.body, l.read_at]),
      [['alice', 'Alice', 'Fancy a coffee at 3?', null]]
    );
    post = await call('bob', 'pick_up_post');
    assert.equal(post.waiting, 0);
    assert.ok(post.letters[0].read_at);
    assert.equal((await call('bob', 'get_me')).letters, 0);
    assert.ok((await call('alice', 'get_post')).sent[0].read_at, 'Alice sees it was picked up');
  });

  test('only the writer and whoever it is for can read a letter', async () => {
    await study('alice', 25);
    await call('alice', 'send_letter', 'bob', 'Just for Bob');
    const read = async (user) =>
      (await asUser(user, 'select body from public.letters')).map((r) => r.body);
    assert.deepEqual(await read('alice'), ['Just for Bob']);
    assert.deepEqual(await read('bob'), ['Just for Bob']);
    assert.deepEqual(await read('carol'), []);
    await rejects(
      asUser(
        'alice',
        `insert into public.letters (from_user, to_user, body) values ($1, $2, 'forged')`,
        [ids.bob, ids.alice]
      ),
      /row-level security/
    );
  });
});

describe('the bins', () => {
  test('take crops, seeds and cigarettes you no longer want', async () => {
    await give('alice', 'carrot', 3);
    await give('alice', 'mug', 1);
    await rejects(call('alice', 'bin_item', 'carrot', 1), /on a break/);
    await study('alice', 5);
    let garden = await call('alice', 'bin_item', 'carrot', 2);
    assert.equal(garden.me.inventory.carrot, 1);
    garden = await call('alice', 'bin_item', 'carrot', 1);
    assert.equal(garden.me.inventory.carrot, undefined);
    await rejects(call('alice', 'bin_item', 'carrot', 1), /Not enough carrot/);
    await rejects(call('alice', 'bin_item', 'mug', 1), /Only crops, seeds and cigarettes/);
    await rejects(call('alice', 'bin_item', 'radish', 0), /1 to 9999/);
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
    assert.equal(shop.items.find((i) => i.slug === 'tomato_seeds').grow_hours, 72);
  });
});

describe('the allotment', () => {
  test('crops grow in real time at their own pace, and half as fast again while watered', async () => {
    await give('alice', 'radish_seeds', 2);
    await study('alice', 5);
    let garden = await call('alice', 'plant', 0, 'radish_seeds');
    assert.equal(garden.me.inventory.radish_seeds, 1);
    let [plot] = garden.me.plots;
    assert.deepEqual(
      [plot.bed, plot.crop, plot.grow_hours, plot.ripe, plot.watered],
      [0, 'radish', 24, false, false]
    );
    assert.ok(plot.progress < 0.001);
    assertNear(Date.parse(plot.ripe_at) - Date.now(), DAY, MIN, 'ripe in a day, unwatered');
    await rejects(call('alice', 'plant', 4, 'radish_seeds'), /no bed 4/);
    await rejects(call('alice', 'plant', 1, 'radish'), /aren't seeds/);
    await rejects(call('alice', 'harvest', 0), /Nothing is ripe/);

    // Half a day on it's half grown, studying or not.
    await travel(12 * 60);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assertNear(plot.progress, 0.5, 0.001, 'progress');

    // Watered, the rest grows half as fast again.
    await study('alice', 5);
    garden = await call('alice', 'water');
    [plot] = garden.me.plots;
    assert.equal(plot.watered, true);
    assertNear(Date.parse(plot.dry_at) - Date.now(), DAY, MIN, 'a watering lasts a day');
    const left = DAY - (12 * HOUR + 5 * MIN);
    assertNear(Date.parse(plot.ripe_at) - Date.now(), left / 1.5, MIN, 'ripe sooner');

    await travel(8 * 60);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.progress], [true, 1]);
    await study('alice', 5);
    garden = await call('alice', 'harvest', 0);
    assert.deepEqual(garden.me.plots, []);
    assert.equal(garden.me.inventory.radish, 1, 'a radish plant gives one radish');
  });

  test('one seed makes one plant, and a bed holds four', async () => {
    await give('alice', 'radish_seeds', 5);
    await give('alice', 'carrot_seeds', 1);
    await study('alice', 5);
    for (let i = 0; i < 3; i++) await call('alice', 'plant', 0, 'radish_seeds');
    let garden = await call('alice', 'plant', 0, 'carrot_seeds');
    assert.deepEqual(
      garden.me.plots.map((p) => [p.bed, p.spot, p.crop]),
      [
        [0, 0, 'radish'],
        [0, 1, 'radish'],
        [0, 2, 'radish'],
        [0, 3, 'carrot'],
      ]
    );
    await rejects(call('alice', 'plant', 0, 'radish_seeds'), /full: it holds four/);
    garden = await call('alice', 'plant', 1, 'radish_seeds');
    assert.equal(garden.me.inventory.radish_seeds, 1);

    // A day on, the radishes are ripe and the carrot isn't: picking a bed
    // takes what's ripe in it, a root a plant.
    await travel(24 * 60);
    await study('alice', 5);
    garden = await call('alice', 'harvest', 0);
    assert.equal(garden.me.inventory.radish, 3);
    assert.deepEqual(
      garden.me.plots.map((p) => [p.bed, p.spot, p.crop]),
      [
        [0, 3, 'carrot'],
        [1, 0, 'radish'],
      ]
    );
    // The spots picked take seeds again.
    garden = await call('alice', 'plant', 0, 'radish_seeds');
    assert.deepEqual(
      garden.me.plots.filter((p) => p.bed === 0).map((p) => p.spot),
      [0, 3]
    );
  });

  test('clearing a bed pulls up only what has withered', async () => {
    await give('alice', 'radish_seeds', 1);
    await give('alice', 'pumpkin_seeds', 1);
    await study('alice', 5);
    await call('alice', 'plant', 0, 'radish_seeds');
    await call('alice', 'plant', 0, 'pumpkin_seeds');
    // Three days on, the radish has withered and the pumpkin is still growing.
    await travel(3 * 24 * 60 + 1);
    await study('alice', 5);
    await rejects(call('alice', 'harvest', 0), /withered/);
    const garden = await call('alice', 'clear_bed', 0);
    assert.deepEqual(
      garden.me.plots.map((p) => [p.spot, p.crop, p.withered]),
      [[1, 'pumpkin', false]]
    );
  });

  test('a ripe crop keeps for 2 days, then withers to nothing until the bed is cleared', async () => {
    await give('alice', 'radish_seeds', 2);
    await study('alice', 5);
    await call('alice', 'plant', 0, 'radish_seeds');
    await travel(24 * 60); // ripe now
    let me = await study('alice', 5);
    assert.deepEqual(
      me.ripe.map((r) => [r.bed, r.crop]),
      [[0, 'radish']]
    );
    let [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [true, false]);
    assert.equal(Date.parse(plot.withers_at) - Date.parse(plot.ripe_at), 2 * DAY);
    assert.equal(me.ripe[0].withers_at, plot.withers_at);
    await rejects(call('alice', 'clear_bed', 0), /nothing withered/);
    // Watering a ripe crop doesn't buy it more time.
    [plot] = (await call('alice', 'water')).me.plots;
    assert.equal(Date.parse(plot.withers_at) - Date.parse(me.ripe[0].withers_at), 0);

    // 47 hours after ripening they're still good...
    await travel(47 * 60 - 5);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [true, false]);

    // ...but an hour later they've withered: nothing to pick, and not "ripe" any more.
    await travel(60);
    [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.ripe, plot.withered], [false, true]);
    assert.deepEqual((await call('alice', 'get_me')).ripe, []);
    await study('alice', 5);
    await rejects(call('alice', 'harvest', 0), /withered/);

    const garden = await call('alice', 'clear_bed', 0);
    assert.deepEqual(garden.me.plots, []);
    assert.equal(garden.me.inventory.radish, undefined, 'a withered crop gives nothing');
    await call('alice', 'plant', 0, 'radish_seeds');
  });

  test('crops grow and wither on time while nobody is looking', async () => {
    await give('alice', 'radish_seeds', 1);
    await study('alice', 5);
    await call('alice', 'plant', 0, 'radish_seeds');
    // A day to ripen and two to keep: three days and a minute later, it's gone over.
    await travel(3 * 24 * 60 + 1);
    const [plot] = (await call('alice', 'get_garden')).me.plots;
    assert.deepEqual([plot.progress, plot.withered], [1, true]);
  });

  test('every crop takes its own time: a day for radishes, five for a pumpkin', async () => {
    const shop = await call('alice', 'get_shop');
    const hours = Object.fromEntries(
      shop.items.filter((i) => i.kind === 'seed').map((i) => [i.slug, i.grow_hours])
    );
    assert.deepEqual(hours, {
      radish_seeds: 24,
      carrot_seeds: 36,
      sunflower_seeds: 96,
      strawberry_seeds: 48,
      tomato_seeds: 72,
      pumpkin_seeds: 120,
    });
  });

  test("you can water a friend's beds, but not harvest them", async () => {
    await give('bob', 'radish_seeds', 1);
    await study(['alice', 'bob'], 25);
    await call('bob', 'plant', 0, 'radish_seeds');

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
  test('uses a cigarette, which burns out after 3 minutes', async () => {
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
    await travel(2.9);
    board = await call('bob', 'get_friends_board');
    assert.equal(board.find((f) => f.username === 'alice').activity, 'smoking');
    await travel(0.2);
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
    await call('bob', 'place_desk_item', 'mug', 36, -26);
    await call('bob', 'place_desk_item', 'lamp', -36, -24);
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
    // Back to front.
    assert.deepEqual(bob.desk_items, [
      { item: 'mug', x: 36, y: -26 },
      { item: 'lamp', x: -36, y: -24 },
    ]);
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
      studying_until: null,
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

  test('the website hands out invites to anyone: 10 an hour, 30 a day', async () => {
    await q(`delete from public.invites where from_website`);
    const first = await call('anon', 'website_invite');
    assert.match(first.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    // Made by nobody, and good for 2 days.
    const [made] = await q(
      `select created_by, from_website,
         extract(epoch from expires_at - created_at)::int as lasts
       from public.invites where code = $1`,
      [first.code]
    );
    assert.deepEqual(made, { created_by: null, from_website: true, lasts: 2 * 24 * 3600 });
    assert.equal(new Date(first.expires_at).getTime() > Date.now(), true);

    // Signed in or not, it's the same limit for everyone.
    for (let i = 1; i < 9; i++) assert.ok((await call('anon', 'website_invite')).code);
    assert.ok((await call('alice', 'website_invite')).code);
    assert.deepEqual(await call('anon', 'website_invite'), { code: null, reason: 'busy' });

    // An hour on, ten more; then the day's 30 are gone until a day's passed.
    const later = (minutes) =>
      q(
        `update public.invites set created_at = created_at - make_interval(mins => ${minutes})
         where from_website`
      );
    await later(61);
    for (let i = 0; i < 10; i++) assert.ok((await call('anon', 'website_invite')).code);
    await later(61);
    for (let i = 0; i < 10; i++) assert.ok((await call('anon', 'website_invite')).code);
    await later(61);
    assert.deepEqual(await call('anon', 'website_invite'), { code: null, reason: 'busy' });
    await later(24 * 60);
    assert.ok((await call('anon', 'website_invite')).code);
  });

  test('joining with a website invite: from Focus, with no friends yet', async () => {
    const { code } = await call('anon', 'website_invite');
    assert.deepEqual(await call('anon', 'check_signup', code, 'wendy'), {
      ok: true,
      from: 'Focus',
      studying_until: null,
    });
    await signUp('wendy', code, { name: 'Wendy' });
    assert.deepEqual(await call('wendy', 'get_friends_board'), []);

    // Left two days, it's no good.
    const old = await call('anon', 'website_invite');
    await travel(2 * 24 * 60 + 1);
    await rejects(signUp('xena', old.code), /invite-only/);
  });

  test("players' own invites don't count towards the website's", async () => {
    await q(`delete from public.invites where from_website`);
    await q(`delete from public.invites where created_by = $1 and used_by is null`, [ids.carol]);
    for (let i = 0; i < 5; i++) await call('carol', 'create_invite');
    for (let i = 0; i < 10; i++) assert.ok((await call('anon', 'website_invite')).code);
    await q(`delete from public.invites where created_by = $1 and used_by is null`, [ids.carol]);
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

    // Skipping grows crops as if the time had passed...
    await study('alice', 5);
    await call('alice', 'dev_item', 'radish_seeds', 2);
    await call('alice', 'plant', 1, 'radish_seeds');
    await call('alice', 'dev_skip', 12 * 60);
    let [half] = (await call('alice', 'get_garden')).me.plots;
    assertNear(half.progress, 0.5, 0.001, 'progress');
    await call('alice', 'dev_skip', 12 * 60);
    [half] = (await call('alice', 'get_garden')).me.plots;
    assert.equal(half.ripe, true);
    await q('delete from public.plots');

    // ...and a ripe crop skipped past its two days withers.
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

describe('the car park', () => {
  /** Buys `user` a vehicle (and leaves them with `chips` after). */
  async function drives(user, vehicle = 'hatchback', chips = 0) {
    const [{ price }] = await q('select price from public.items where slug = $1', [vehicle]);
    await setChips(user, price + chips);
    await call(user, 'buy', vehicle);
  }

  test('parking your vehicle is arriving, and friends see where you left it', async () => {
    await rejects(call('alice', 'park', 100, 300, 0.5), /on foot/);
    await drives('alice');
    let me = await call('alice', 'park', 100, 300, 0.5);
    assert.equal(me.status, 'idle');
    assert.equal(me.place, 'outside');
    assert.notEqual(me.desk, null);
    assert.deepEqual(me.parked, { x: 100, y: 300, a: 0.5 });
    assert.equal(me.vehicle_health, 100);
    let alice = (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice');
    assert.deepEqual(alice.parked, { x: 100, y: 300, a: 0.5 });
    assert.equal(alice.vehicle_health, 100);

    // Kept to the car park (which carries on a little past either side), and
    // facing somewhere between 0 and a full turn.
    me = await call('alice', 'park', -500, 9999, -1);
    assert.equal(me.parked.x, -80);
    assert.equal(me.parked.y, 660);
    assertNear(me.parked.a, 2 * Math.PI - 1, 0.001, 'heading');
    me = await call('alice', 'park', 900, 0, 0);
    assert.deepEqual(me.parked, { x: 460, y: 150, a: 0 });
    // Up on the pavement, as a bike in the rack is.
    me = await call('alice', 'park', 22, 202, 0);
    assert.deepEqual(me.parked, { x: 22, y: 202, a: 0 });

    await call('alice', 'start_session', 5);
    await rejects(call('alice', 'park', 100, 300, 0), /studying/);
    await call('alice', 'cancel_session');

    // Your vehicle goes home with you.
    me = await call('alice', 'go_home');
    assert.equal(me.parked, null);
    alice = (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice');
    assert.equal(alice.parked, null);
  });

  test('walking about the car park is being at work, and you can smoke there', async () => {
    await give('alice', 'cigarette', 2);
    await rejects(call('alice', 'smoke'), /Park up or walk about first/);
    let me = await call('alice', 'set_place', 'outside');
    assert.equal(me.status, 'idle');
    assert.equal(me.place, 'outside');
    assert.notEqual(me.desk, null);
    const garden = await call('alice', 'smoke');
    assert.equal(garden.me.activity, 'smoking');
    const alice = (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice');
    assert.equal(alice.activity, 'smoking');
    assert.ok(alice.activity_until);

    // While the app's open out there, you're still at work, long after arriving.
    for (let i = 0; i < 20; i++) {
      await travel(1);
      me = await call('alice', 'get_me');
    }
    assert.equal(me.status, 'idle');
    await travel(3);
    const board = await call('bob', 'get_friends_board');
    assert.equal(board.find((f) => f.username === 'alice').status, 'absent');
  });

  test("driving into a friend's vehicle damages both, and they can claim damages", async () => {
    await drives('alice');
    await drives('bob');
    await drives('carol');
    await call('alice', 'park', 100, 300, 0);
    await call('bob', 'park', 200, 300, 0);
    await call('carol', 'park', 300, 300, 0);

    await rejects(call('alice', 'crash', 'carol', 120), /only bump into friends/);
    let me = await call('alice', 'crash', 'bob', 10);
    assert.equal(me.vehicle_health, 100, 'a nudge does nothing');
    assert.deepEqual(me.crashes, []);

    me = await call('alice', 'crash', 'bob', 120);
    assert.equal(me.vehicle_health, 80);
    assert.equal(me.crashes.length, 1);
    const [crash] = me.crashes;
    assert.equal(crash.driver, 'alice');
    assert.equal(crash.owner, 'bob');
    assert.equal(crash.vehicle, 'hatchback');
    assert.equal(crash.damage, 20);
    assert.equal(crash.cost, 30, 'half the price for a wreck, so 30 for 20 damage to a 300');
    assert.equal(crash.status, 'open');
    me = await call('alice', 'crash', 'bob', 120);
    assert.equal(me.vehicle_health, 80, 'crumpling into it again is the same crash');

    let bob = await call('bob', 'get_me');
    assert.equal(bob.vehicle_health, 80);
    assert.deepEqual(
      bob.crashes.map((c) => [c.id, c.driver_name, c.status]),
      [[crash.id, 'Alice', 'open']]
    );
    await rejects(call('alice', 'claim_crash', crash.id, true), /settled/);

    // alice hasn't the chips to pay it all: she pays what she has.
    await setChips('alice', 25);
    bob = await call('bob', 'claim_crash', crash.id, true);
    assert.equal(bob.vehicle_health, 100, 'put right');
    assert.equal(bob.crashes[0].status, 'claimed');
    assert.equal(bob.crashes[0].paid_by, 'driver');
    assert.equal(bob.crashes[0].paid, 25);
    me = await call('alice', 'get_me');
    assert.equal(me.chips, 0);
    assert.equal(me.vehicle_health, 80, 'your own damage is yours to repair');
    await rejects(call('bob', 'claim_crash', crash.id, true), /settled/);

    // Only friends who are here.
    await call('bob', 'go_home');
    await travel(1);
    await rejects(call('alice', 'crash', 'bob', 120), /Bob hasn't parked here/);
  });

  test('insurance pays claims for crashes while it lasts; or the owner lets them go', async () => {
    await rejects(call('alice', 'buy_insurance'), /nothing to insure/);
    await drives('alice', 'hatchback', 100);
    await drives('bob');
    await call('bob', 'park', 200, 300, 0);
    let shop = await call('alice', 'buy_insurance');
    assert.equal(shop.chips, 70);
    assert.equal(shop.insurance_price, 30);
    assert.equal(shop.insurance_days, 7);
    assertNear(Date.parse(shop.insured_until) - Date.now(), 7 * DAY, MIN, 'insured for a week');

    await call('alice', 'park', 100, 300, 0);
    let me = await call('alice', 'crash', 'bob', 300);
    assert.equal(me.vehicle_health, 70, 'at most 30 a crash');
    let bob = await call('bob', 'claim_crash', me.crashes[0].id, true);
    assert.equal(bob.crashes[0].paid_by, 'insurer');
    assert.equal(bob.crashes[0].paid, 0);
    assert.equal(bob.vehicle_health, 100);
    assert.equal((await call('alice', 'get_me')).chips, 70);

    // A week on, it's run out.
    await travel(7 * 24 * 60 + 1);
    for (const user of ['alice', 'bob']) await call(user, 'set_place', 'outside');
    me = await call('alice', 'crash', 'bob', 60);
    assert.equal(me.insured_until, null);
    const open = me.crashes.find((c) => c.status === 'open');
    bob = await call('bob', 'claim_crash', open.id, false);
    assert.equal(bob.crashes.find((c) => c.id === open.id).status, 'waived');
    assert.equal(bob.vehicle_health, 90, 'let go, so not put right');
    assert.equal((await call('alice', 'get_me')).chips, 70);

    await setChips('alice', 200);
    for (let i = 0; i < 4; i++) shop = await call('alice', 'buy_insurance');
    await rejects(call('alice', 'buy_insurance'), /weeks yet/);
    assertNear(Date.parse(shop.insured_until) - Date.now(), 28 * DAY, MIN, 'four weeks ahead');
  });

  test('driving into a lamp post damages your own vehicle', async () => {
    await rejects(call('alice', 'bump', 120), /not driving anything/);
    await drives('alice');
    let me = await call('alice', 'bump', 10);
    assert.equal(me.vehicle_health, 100, 'a nudge does nothing');
    me = await call('alice', 'bump', 120);
    assert.equal(me.vehicle_health, 80);
    me = await call('alice', 'bump', 120);
    assert.equal(me.vehicle_health, 80, 'crumpling into it again is the same bump');
    await travel(0.1);
    me = await call('alice', 'bump', 600);
    assert.equal(me.vehicle_health, 50, 'at most 30 a bump');
    assert.deepEqual(me.crashes, [], "there's nobody to claim");

    await call('alice', 'start_session', 5);
    await rejects(call('alice', 'bump', 120), /studying/);
  });

  test('the shed repairs your vehicle, and a wreck stays at home', async () => {
    await drives('alice');
    await drives('bob', 'campervan');
    await call('bob', 'park', 200, 300, 0);
    await call('alice', 'park', 100, 300, 0);
    await call('alice', 'crash', 'bob', 120);
    await setChips('alice', 100);
    let shop = await call('alice', 'get_shop');
    assert.equal(shop.vehicle_health, 80);
    assert.equal(shop.repair_cost, 30);
    shop = await call('alice', 'repair_vehicle');
    assert.equal(shop.vehicle_health, 100);
    assert.equal(shop.chips, 70);
    await rejects(call('alice', 'repair_vehicle'), /doesn't need repairing/);

    await q('update public.profiles set vehicle_health = 0 where id = $1', [ids.alice]);
    await rejects(call('alice', 'park', 100, 300, 0), /hatchback is a wreck/);
    await rejects(call('alice', 'crash', 'bob', 120), /not driving anything/);
    await setChips('alice', 0);
    await rejects(call('alice', 'repair_vehicle'), /Not enough chips/);
    assert.equal((await call('alice', 'get_shop')).repair_cost, 150);

    // A new vehicle comes without a scratch.
    await setChips('alice', 500);
    shop = await call('alice', 'buy', 'estate');
    assert.equal(shop.vehicle, 'estate');
    assert.equal(shop.vehicle_health, 100);
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

  test('anonymous callers can only check an invite, or get one from the website', async () => {
    for (const fn of [
      'get_garden',
      'get_shop',
      'water',
      'smoke',
      'go_home',
      'arrive',
      'create_invite',
      'get_friend_requests',
      'get_friends_of_friends',
    ]) {
      await rejects(call('anon', fn), /permission denied/);
    }
    assert.equal((await call('anon', 'check_signup', 'X', 'y')).ok, false);
  });

  test('the garden: friends and their friends hear you walk, but only friends hear you talk', async () => {
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      for (const kind of ['garden', 'garden-chat']) {
        await q(
          `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'x')`,
          [`${kind}:${name}`]
        );
      }
    }
    await q(
      `insert into realtime.messages (topic, extension, event) values ('garden:bob', 'presence', 'x')`
    );

    const hears = async (user, topic) =>
      (await asUser(user, 'select count(*)::int as n from realtime.messages', [], topic))[0].n > 0;
    // alice's friend is bob; carol is bob's friend; dave is carol's.
    assert.equal(await hears('alice', 'garden:alice'), true);
    assert.equal(await hears('alice', 'garden-chat:alice'), true);
    assert.equal(await hears('alice', 'garden:bob'), true);
    assert.equal(await hears('alice', 'garden-chat:bob'), true);
    assert.equal(await hears('alice', 'garden:carol'), true, 'a friend of a friend walks');
    assert.equal(await hears('alice', 'garden-chat:carol'), false, 'but talks to friends');
    assert.equal(await hears('alice', 'garden:dave'), false, 'further off');
    assert.equal(await hears('alice', 'garden-chat:dave'), false);
    assert.equal(await hears('carol', 'garden-chat:bob'), true);
    assert.equal(await hears('alice', 'office:bob'), false);

    const speak = (user, topic) =>
      asUser(
        user,
        `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'x')`,
        [topic],
        topic
      );
    await speak('alice', 'garden:alice');
    await speak('alice', 'garden-chat:alice');
    for (const topic of ['garden:bob', 'garden-chat:bob', 'garden:carol', 'garden-chat:carol']) {
      await rejects(speak('alice', topic), /row-level security/, topic);
    }
  });
});

describe('the car park channels', () => {
  test("work as the garden's do: friends and theirs hear you walk, only friends hear you talk", async () => {
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      for (const kind of ['carpark', 'carpark-chat']) {
        await q(
          `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'x')`,
          [`${kind}:${name}`]
        );
      }
    }
    const hears = async (user, topic) =>
      (await asUser(user, 'select count(*)::int as n from realtime.messages', [], topic))[0].n > 0;
    assert.equal(await hears('alice', 'carpark:alice'), true);
    assert.equal(await hears('alice', 'carpark:bob'), true);
    assert.equal(await hears('alice', 'carpark-chat:bob'), true);
    assert.equal(await hears('alice', 'carpark:carol'), true, 'a friend of a friend walks');
    assert.equal(await hears('alice', 'carpark-chat:carol'), false, 'but talks to friends');
    assert.equal(await hears('alice', 'carpark:dave'), false, 'further off');

    const speak = (user, topic) =>
      asUser(
        user,
        `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'x')`,
        [topic],
        topic
      );
    await speak('alice', 'carpark:alice');
    await speak('alice', 'carpark-chat:alice');
    await rejects(speak('alice', 'carpark:bob'), /row-level security/);
  });
});

// These come last: they sign up new players and change friendships, which the
// tests above don't expect.
describe('usernames', () => {
  test('can have accents, and the account email is the plain spelling', async () => {
    const { code } = await call('alice', 'create_invite');
    assert.equal((await call('anon', 'check_signup', code, ' José ')).ok, true);
    assert.equal((await call('anon', 'check_signup', code, 'straße')).ok, true);
    assert.equal((await call('anon', 'check_signup', code, 'zoë_øre')).ok, true);
    for (const bad of ['jo', 'ab!', 'ǃǃǃ', 'аня', '😀😀😀', 'a'.repeat(21), 'jo sé']) {
      assert.match((await call('anon', 'check_signup', code, bad)).reason, /3 to 20/, bad);
    }

    // The email has to be the plain spelling, which is what the app signs in with.
    await rejects(signUp('josé', code, { email: 'josé@focus.test' }), /must be/);
    // A decomposed é (e + accent) is the same username as a composed one.
    await signUp('jose\u0301', code, { email: 'jose@focus.test', name: 'José' });
    ids['josé'] = ids['jose\u0301'];
    const me = await call('josé', 'get_me');
    assert.equal(me.username, 'josé');
    assert.equal(me.display_name, 'José');
    assert.deepEqual((await call('alice', 'get_friends_board')).map((f) => f.username).sort(), [
      'bob',
      'josé',
    ]);

    // Spellings that differ only in accents can't both be taken.
    const next = await call('alice', 'create_invite');
    assert.match((await call('anon', 'check_signup', next.code, 'josé')).reason, /taken/);
    assert.match(
      (await call('anon', 'check_signup', next.code, 'jose')).reason,
      /too close to @josé/
    );
    await rejects(
      q(`update public.profiles set username = 'jösé' where id = $1`, [ids.alice]),
      /duplicate key/
    );
    await rejects(
      q(`update public.profiles set username = 'Ìnés' where id = $1`, [ids.alice]),
      /username_check/
    );
  });

  test('friends can be added by either spelling', async () => {
    const asked = await call('carol', 'add_friend', ' JOSE ');
    assert.deepEqual(asked, { username: 'josé', friends: false });
    await rejects(call('carol', 'add_friend', 'josé'), /already asked josé/);
    assert.deepEqual(await call('josé', 'answer_friend_request', 'CAROL', true), {
      to_you: [],
      from_you: [],
    });
    await rejects(call('carol', 'add_friend', 'josé'), /already friends with josé/);
    await rejects(call('carol', 'add_friend', 'nobody_here'), /No user called "nobody_here"/);
    await rejects(call('carol', 'add_friend', 'Carol'), /can't add yourself/);
    assert.deepEqual((await call('josé', 'get_friends_board')).map((f) => f.username).sort(), [
      'alice',
      'carol',
    ]);
    await call('carol', 'remove_friend', 'josé');
  });
});

describe('un-adding a friend', () => {
  test('ends the friendship both ways, and hands back anything on offer', async () => {
    await befriend('carol', 'josé');
    await give('carol', 'tomato', 3);
    await give('josé', 'carrot', 2);
    await study(['carol', 'josé'], 25);
    await call('carol', 'offer_trade', 'josé', 'tomato', 2, 'carrot', 1);
    await call('josé', 'offer_trade', 'carol', 'carrot', 1, null, null);
    await call('carol', 'send_letter', 'josé', 'See you in the garden');
    const [offer] = (await call('josé', 'get_garden')).trades.filter((t) => t.incoming);

    await rejects(call('carol', 'remove_friend', 'alice'), /not friends with alice/);
    assert.deepEqual(await call('carol', 'remove_friend', 'josé'), { username: 'josé' });

    // (dave joined with carol's invite earlier.)
    assert.deepEqual((await call('carol', 'get_friends_board')).map((f) => f.username).sort(), [
      'bob',
      'dave',
    ]);
    assert.deepEqual(
      (await call('josé', 'get_friends_board')).map((f) => f.username),
      ['alice']
    );
    // Offers between them are called off, and the goods go home.
    let garden = await call('carol', 'get_garden');
    assert.equal(garden.trades.length, 0);
    assert.equal(garden.me.inventory.tomato, 3);
    garden = await call('josé', 'get_garden');
    assert.equal(garden.trades.length, 0);
    assert.equal(garden.me.inventory.carrot, 2);
    await rejects(call('josé', 'respond_trade', offer.id, true), /no longer open/);

    // Nothing that needs a friendship works any more...
    await rejects(call('carol', 'send_letter', 'josé', 'Hello?'), /only write to friends/);
    await rejects(call('carol', 'water_friend', 'josé'), /friend's plot/);
    await rejects(
      call('josé', 'offer_trade', 'carol', 'carrot', 1, null, null),
      /only trade with friends/
    );
    const hears = async (user, topic) =>
      (await asUser(user, 'select count(*)::int as n from realtime.messages', [], topic))[0].n > 0;
    await q(
      `insert into realtime.messages (topic, extension, event) values ('garden:josé', 'broadcast', 'say')`
    );
    assert.equal(await hears('carol', 'garden:josé'), false);
    assert.equal(await hears('alice', 'garden:josé'), true);

    // ...but letters already sent stay where they are, and they can be friends again.
    assert.equal((await call('josé', 'get_post')).letters.length, 1);
    await rejects(call('carol', 'remove_friend', 'josé'), /not friends with josé/);
    await befriend('josé', 'carol');
    assert.deepEqual((await call('carol', 'get_friends_board')).map((f) => f.username).sort(), [
      'bob',
      'dave',
      'josé',
    ]);
  });
});

describe('asking to be friends', () => {
  test("adding someone asks them, and you're friends once they say yes", async () => {
    // alice and carol aren't friends, but both know bob and josé.
    assert.deepEqual(await call('alice', 'add_friend', 'carol'), {
      username: 'carol',
      friends: false,
    });
    await rejects(call('alice', 'add_friend', 'Carol'), /already asked carol/);
    const boardOf = async (user) =>
      (await call(user, 'get_friends_board')).map((f) => f.username).sort();
    assert.deepEqual(await boardOf('alice'), ['bob', 'josé']);

    assert.equal((await call('carol', 'get_me')).friend_requests, 1);
    assert.deepEqual(await call('carol', 'get_friend_requests'), {
      to_you: [{ username: 'alice', display_name: 'Alice', via: ['Bob', 'José'] }],
      from_you: [],
    });
    assert.deepEqual(await call('alice', 'get_friend_requests'), {
      to_you: [],
      from_you: [{ username: 'carol', display_name: 'Carol' }],
    });
    await rejects(call('alice', 'answer_friend_request', 'carol', true), /No request from carol/);

    assert.deepEqual(await call('carol', 'answer_friend_request', 'alice', true), {
      to_you: [],
      from_you: [],
    });
    assert.deepEqual(await boardOf('alice'), ['bob', 'carol', 'josé']);
    assert.deepEqual(await boardOf('carol'), ['alice', 'bob', 'dave', 'josé']);
    assert.equal((await call('carol', 'get_me')).friend_requests, 0);
    await call('alice', 'remove_friend', 'carol');
  });

  test('asking someone who has asked you makes you friends at once', async () => {
    await call('dave', 'add_friend', 'alice');
    assert.deepEqual(await call('alice', 'add_friend', 'dave'), {
      username: 'dave',
      friends: true,
    });
    assert.deepEqual(await call('dave', 'get_friend_requests'), { to_you: [], from_you: [] });
    assert.ok((await call('dave', 'get_friends_board')).some((f) => f.username === 'alice'));
    await call('alice', 'remove_friend', 'dave');
  });

  test("saying no or withdrawing takes the request away, and nobody's told", async () => {
    await call('dave', 'add_friend', 'bob');
    assert.deepEqual(await call('bob', 'answer_friend_request', 'dave', false), {
      to_you: [],
      from_you: [],
    });
    assert.deepEqual(await call('dave', 'get_friend_requests'), { to_you: [], from_you: [] });
    assert.ok(!(await call('dave', 'get_friends_board')).some((f) => f.username === 'bob'));

    // dave can ask again, then think better of it.
    await call('dave', 'add_friend', 'bob');
    assert.deepEqual(await call('dave', 'withdraw_friend_request', 'bob'), {
      to_you: [],
      from_you: [],
    });
    assert.equal((await call('bob', 'get_me')).friend_requests, 0);
    await rejects(call('dave', 'withdraw_friend_request', 'bob'), /haven't asked bob/);
  });

  test('only the two players can see a request, and nobody can write one directly', async () => {
    await call('dave', 'add_friend', 'alice');
    const seen = async (user) =>
      (await asUser(user, 'select count(*)::int as n from public.friend_requests'))[0].n;
    assert.equal(await seen('dave'), 1);
    assert.equal(await seen('alice'), 1);
    assert.equal(await seen('bob'), 0);
    await rejects(
      asUser('bob', 'insert into public.friend_requests (from_id, to_id) values ($1, $2)', [
        ids.bob,
        ids.alice,
      ]),
      /row-level security/
    );
  });
});

describe("friends' profiles", () => {
  test("show what a friend has studied and what they're worth, to friends only", async () => {
    await study('bob', 30);
    await travel(24 * 60);
    await study('bob', 20);
    await setChips('bob', 100);
    await give('bob', 'mug', 1); // 10 chips in the shed
    await give('bob', 'radish_seeds', 3); // a packet of 3 for 6
    await give('bob', 'tomato', 4); // produce has no price
    await call('bob', 'start_session', 25);

    const bob = await call('alice', 'get_profile', 'BOB');
    assert.equal(bob.username, 'bob');
    assert.equal(bob.display_name, 'Bob');
    assert.equal(bob.status, 'focused');
    assert.ok(Date.parse(bob.ends_at) > Date.now());
    assert.equal(bob.minutes_studied, 50);
    assert.equal(bob.sessions_studied, 2);
    assert.equal(bob.days_studied, 2);
    assert.equal(bob.net_worth, 116);
    assert.ok(Date.parse(bob.friends_since) < Date.now());
    // bob knows alice and carol; alice and bob have nobody else in common.
    assert.equal(bob.friends, 2);
    assert.equal(bob.in_common, 0);
    assert.ok(Math.abs(Date.parse(bob.last_active) - Date.now()) < 5 * MIN, 'about just now');

    await rejects(call('alice', 'get_profile', 'carol'), /not friends with carol/);
  });
});

describe('studying together', () => {
  test("joining a friend's session ends yours when theirs ends", async () => {
    await call('bob', 'start_session', 30);
    await travel(10.5);
    const alice = await call('alice', 'join_session', 'bob', 'page-a');
    const bob = await call('bob', 'get_me');
    assert.equal(alice.status, 'focused');
    assert.equal(alice.active_session.ends_at, bob.active_session.ends_at);
    assert.equal(alice.active_session.duration_min, 20);
    assert.equal(alice.active_session.device, 'page-a');
    assert.equal(alice.place, 'office');
    assert.notEqual(alice.desk, null);
    await rejects(call('alice', 'join_session', 'bob'), /already running/);

    await travel(19.5);
    const ended = [];
    for (const user of ['alice', 'bob']) {
      const me = await call(user, 'get_me');
      assert.equal(me.status, 'on_break', user);
      ended.push(Date.parse(me.last_completed.ended_at));
    }
    assert.equal(ended[0], ended[1]);
  });

  test('only friends who are studying, with a minute or more to go', async () => {
    await rejects(call('alice', 'join_session', 'carol'), /only join friends/);
    await rejects(call('alice', 'join_session', 'bob'), /Bob isn't studying/);
    await call('bob', 'start_session', 5);
    await travel(4.5);
    await rejects(call('alice', 'join_session', 'bob'), /Bob is nearly done/);
  });
});

describe('friends of friends, and changing desks', () => {
  // By now: alice knows bob and josé; carol knows bob, dave and josé. So carol
  // is a friend of alice's friends, and dave is further off.
  const atDesk = (user, desk) =>
    q(`update public.profiles set desk = $2, arrived_at = now(), seen_at = now() where id = $1`, [
      ids[user],
      desk,
    ]);

  test('friends of friends at work show, with which of your friends they know', async () => {
    assert.deepEqual(await call('alice', 'get_friends_of_friends'), []);
    await call('carol', 'set_place', 'office');
    await call('bob', 'set_place', 'office');
    await call('dave', 'set_place', 'office');

    const [carol, ...others] = await call('alice', 'get_friends_of_friends');
    assert.deepEqual(others, []);
    assert.equal(carol.username, 'carol');
    assert.equal(carol.display_name, 'Carol');
    assert.equal(carol.status, 'idle');
    assert.equal(carol.place, 'office');
    assert.equal(carol.desk, (await call('carol', 'get_me')).desk);
    assert.deepEqual(carol.desk_items, []);
    assert.deepEqual(carol.via, ['Bob', 'José']);

    // dave sees bob and josé the same way, through carol.
    assert.deepEqual(
      (await call('dave', 'get_friends_of_friends')).map((p) => [p.username, p.via]),
      [['bob', ['Carol']]]
    );
    await call('carol', 'go_home');
    assert.deepEqual(await call('alice', 'get_friends_of_friends'), []);
  });

  test("arriving avoids friends' and their friends' desks", async () => {
    // Eight more of bob's friends, so alice's circle can fill every desk but one.
    const mates = [];
    for (let i = 1; i <= 8; i++) {
      const [{ code }] = await q('select private.make_invite($1) as code', [ids.bob]);
      await signUp(`mate${i}`, code);
      mates.push(`mate${i}`);
    }
    const circle = ['bob', 'josé', 'carol', ...mates];
    for (const [i, user] of circle.entries()) await atDesk(user, i < 7 ? i : i + 1);
    // dave is at desk 7, but he's no friend of a friend of alice's.
    await atDesk('dave', 7);

    assert.equal((await call('alice', 'set_place', 'office')).desk, 7);

    for (const mate of mates) await call('bob', 'remove_friend', mate);
  });

  test('you can move to a desk nobody in your circle is at, between sessions', async () => {
    await rejects(call('alice', 'switch_desk', 2), /Walk into the office first/);
    await atDesk('bob', 3); // a friend
    await atDesk('carol', 4); // a friend of a friend
    await atDesk('dave', 5); // neither
    await call('alice', 'set_place', 'garden');
    await call('alice', 'set_place', 'office');

    await rejects(call('alice', 'switch_desk', 3), /Someone's at that desk/);
    await rejects(call('alice', 'switch_desk', 4), /Someone's at that desk/);
    await rejects(call('alice', 'switch_desk', 12), /no desk 12/);
    await call('alice', 'set_place', 'garden');
    const me = await call('alice', 'switch_desk', 5);
    assert.equal(me.desk, 5);
    assert.equal(me.place, 'office');
    assert.equal(
      (await call('bob', 'get_friends_board')).find((f) => f.username === 'alice').desk,
      5
    );

    await call('alice', 'start_session', 25);
    await rejects(call('alice', 'switch_desk', 6), /while you're studying/);
  });
});

describe('looks', () => {
  const look = { skin: 5, colour: 2, hair: 'bun', hair_colour: 4 };

  test('you choose from the skin tones, colours and hairstyles on offer', async () => {
    assert.deepEqual(await call('alice', 'set_looks', look), { alice: look });
    for (const bad of [
      { ...look, skin: 6 },
      { ...look, colour: -1 },
      { ...look, colour: 1.5 },
      { ...look, hair_colour: '3' },
      { ...look, hair: 'mohican' },
      { ...look, hat: 'top' },
      { skin: 1, colour: 1, hair: 'short' },
      [look],
      5,
    ]) {
      await rejects(call('alice', 'set_looks', JSON.stringify(bad)), /isn't one of the choices/);
    }
    await rejects(
      q(`update public.profiles set looks = '{"skin": 9}' where id = $1`, [ids.alice]),
      /check constraint/
    );
  });

  test('friends and their friends see your looks; nobody else does', async () => {
    await call('carol', 'set_looks', look);
    // carol is bob's friend and a friend of alice's friends; mate1 is nobody's friend now.
    const bobSees = await call('bob', 'get_looks');
    assert.equal(bobSees.carol.hair, 'bun');
    assert.equal('bob' in bobSees, false, "bob hasn't chosen, so the app picks for him");
    assert.equal((await call('alice', 'get_looks')).carol.skin, 5);
    assert.equal((await call('carol', 'get_looks')).carol.colour, 2);
    assert.equal('carol' in (await call('mate1', 'get_looks')), false);
  });
});

describe('arranging your desk', () => {
  const things = async (user) =>
    (await call(user, 'get_me')).desk_items.map(({ item, x, y }) => [item, x, y]);

  test('new things start in the drawer, and go where you put them, kept to the desk top', async () => {
    await give('alice', 'mug', 1);
    await give('alice', 'lamp', 1);
    assert.deepEqual(await things('alice'), []);

    const me = await call('alice', 'place_desk_item', 'mug', 10.5, -20);
    assert.deepEqual(me.desk_items, [{ item: 'mug', x: 10.5, y: -20 }]);
    await call('alice', 'place_desk_item', 'lamp', 99, -99);
    assert.deepEqual(await things('alice'), [
      ['lamp', 42, -44],
      ['mug', 10.5, -20],
    ]);
    // Friends see it as it is.
    const board = await call('bob', 'get_friends_board');
    assert.deepEqual(board.find((f) => f.username === 'alice').desk_items, [
      { item: 'lamp', x: 42, y: -44 },
      { item: 'mug', x: 10.5, y: -20 },
    ]);
  });

  test('things put away go back in the drawer, and can come out again', async () => {
    await give('alice', 'mug', 1);
    await give('alice', 'duck', 1);
    await call('alice', 'place_desk_item', 'mug', -36, -24);
    await call('alice', 'place_desk_item', 'duck', 36, -26);
    await call('alice', 'store_desk_item', 'mug');
    assert.deepEqual(await things('alice'), [['duck', 36, -26]]);
    assert.equal((await call('alice', 'get_me')).inventory.mug, 1, 'still yours, in the drawer');
    await call('alice', 'place_desk_item', 'mug', 0, -40);
    assert.deepEqual((await things('alice'))[0], ['mug', 0, -40]);
  });

  test('only between sessions, and only your own desk things', async () => {
    await give('alice', 'mug', 1);
    await give('alice', 'tomato', 2);
    await rejects(call('alice', 'place_desk_item', 'lamp', 0, -20), /haven't got that/);
    await rejects(call('alice', 'place_desk_item', 'tomato', 0, -20), /haven't got that/);
    await rejects(call('alice', 'place_desk_item', 'mug', null, -20), /Somewhere on the desk/);
    await call('alice', 'start_session', 25);
    await rejects(call('alice', 'place_desk_item', 'mug', 0, -20), /Not while you're studying/);
    await rejects(call('alice', 'store_desk_item', 'mug'), /Not while you're studying/);
    await rejects(
      asUser('alice', `insert into public.desk_layout values ($1, 'mug', 0, -20)`, [ids.alice]),
      /row-level security/
    );
  });
});

describe('notifications', () => {
  const device = (user, n = 1) =>
    call(user, 'save_push', `https://push.example/${user}/${n}`, 'p256dh', 'auth');
  const due = async () =>
    (await asService('due_pushes')).map(({ endpoint, title, body, url }) => ({
      to: endpoint.replace('https://push.example/', ''),
      title,
      body,
      url,
    }));

  test('a device is saved for whoever is signed in on it, and can be dropped', async () => {
    await device('alice');
    const mine = (user) => asUser(user, 'select endpoint from public.push_subscriptions');
    assert.equal((await mine('alice')).length, 1);
    assert.equal((await mine('bob')).length, 0);
    // bob signs in on alice's phone: it's his now.
    await call('bob', 'save_push', 'https://push.example/alice/1', 'p256dh', 'auth');
    assert.equal((await mine('alice')).length, 0);
    await call('alice', 'drop_push', 'https://push.example/alice/1');
    assert.equal((await mine('bob')).length, 1, "alice can't drop bob's device");
    await call('bob', 'drop_push', 'https://push.example/alice/1');
    assert.equal((await mine('bob')).length, 0);

    await rejects(call('alice', 'save_push', 'http://insecure.example', 'p', 'a'), /check/);
    await rejects(call('anon', 'save_push', 'https://push.example/x', 'p', 'a'), /permission/);
    await rejects(call('alice', 'due_pushes'), /permission denied/);
  });

  test('friends hear when you start studying, unless they are studying too', async () => {
    for (const user of ['alice', 'bob', 'carol']) await device(user);
    await call('carol', 'start_session', 25);
    assert.deepEqual(await due(), [
      {
        to: 'bob/1',
        title: 'Carol is studying right now',
        body: '25 minutes. Join them in the office?',
        url: '/office',
      },
    ]);
    assert.deepEqual(await due(), [], 'once');

    // bob starts too: alice hears, but carol's busy studying.
    await call('bob', 'start_session', 50);
    assert.deepEqual(
      (await due()).map((p) => [p.to, p.title]),
      [['alice/1', 'Bob is studying right now']]
    );
  });

  test("you hear when your session's done and when your break's over", async () => {
    await device('alice');
    await call('alice', 'start_session', 5);
    await due();
    await travel(5);
    const [done, ...rest] = await due();
    assert.deepEqual(rest, []);
    assert.equal(done.to, 'alice/1');
    assert.equal(done.title, "Your session's done");
    assert.match(done.body, /^\d+ chips, and a 1-minute break\.$/);
    assert.equal(done.url, '/payout');

    await travel(1);
    assert.deepEqual(await due(), [
      { to: 'alice/1', title: "Your break's over", body: 'Back to the office, or home?', url: '/' },
    ]);
    assert.deepEqual(await due(), []);

    // Going home (or starting again) first: no word that the break is over.
    await call('alice', 'start_session', 25);
    await travel(25);
    await due();
    await call('alice', 'go_home');
    await travel(6);
    assert.deepEqual(await due(), []);
  });

  test('you hear when someone asks to be friends, unless they think better of it', async () => {
    await device('alice');
    await device('bob');
    await call('dave', 'add_friend', 'alice');
    await call('dave', 'add_friend', 'bob');
    await call('dave', 'withdraw_friend_request', 'bob');
    assert.deepEqual(await due(), [
      {
        to: 'alice/1',
        title: 'Dave would like to be friends',
        body: 'Answer on the Friends board.',
        url: '/friends',
      },
    ]);
  });

  test('nothing old is sent after a gap, and a giving-up sends nothing', async () => {
    await device('alice');
    await device('bob');
    await call('bob', 'start_session', 30);
    await travel(11);
    assert.deepEqual(await due(), [], 'too long ago to say');
    await call('bob', 'cancel_session');
    assert.deepEqual(await due(), []);
  });
});

describe('streaks', () => {
  /** Sessions alice started a minute after midnight in London, `days` days ago each. */
  async function studiedDaysAgo(days, { status = 'completed', skipped = false } = {}) {
    await q('delete from public.sessions');
    for (const d of days) {
      await q(
        `insert into public.sessions (user_id, started_at, ended_at, duration_min, status, chips, skipped)
         select $1, t, t + interval '25 minutes', 25, $3, 25, $4
         from (select ((now() at time zone 'Europe/London')::date - $2::integer + time '00:01')
                      at time zone 'Europe/London' as t) s`,
        [ids.alice, d, status, skipped]
      );
    }
    return (await call('alice', 'get_me')).streak;
  }

  test('count the days in a row you studied, as days go in London', async () => {
    assert.equal((await call('alice', 'get_me')).streak, 0);
    assert.equal((await study('alice', 25)).streak, 1);

    assert.equal(await studiedDaysAgo([0, 1, 1, 2]), 3, 'two sessions in a day count once');
    assert.equal(await studiedDaysAgo([1, 2]), 2, 'it holds until today is over');
    assert.equal(await studiedDaysAgo([0, 2, 3]), 1, 'a day off starts it again');
    assert.equal(await studiedDaysAgo([2, 3]), 0, 'and so does missing yesterday and today');
  });

  test("skipped sessions and giving up don't count", async () => {
    assert.equal(await studiedDaysAgo([0], { skipped: true }), 0);
    assert.equal(await studiedDaysAgo([0], { status: 'cancelled' }), 0);
  });
});

describe('emails', () => {
  test('signing up needs a real email address, which only you can read', async () => {
    const { code } = await call('alice', 'create_invite');
    for (const contact of [
      null,
      '',
      'gina',
      'gina@focus.test',
      'gina@@mail.com',
      'Gina@Example.com',
      'gina@mail',
    ]) {
      await rejects(signUp('gina', code, { contact }), /real email/, String(contact));
    }
    assert.match((await call('anon', 'check_signup', code, 'gina', 'nope')).reason, /real email/);
    assert.equal((await call('anon', 'check_signup', code, 'gina', 'gina@uni.ac.uk')).ok, true);

    await signUp('gina', code, { contact: '  Gina.Smith+focus@GMail.com ' });
    assert.equal((await call('gina', 'get_me')).email, 'gina.smith+focus@gmail.com');
    assert.deepEqual(
      (await asUser('alice', 'select email from public.emails')).map((r) => r.email),
      ['alice@studymail.co.uk']
    );

    // Players can change theirs, but only to a real one.
    await rejects(call('gina', 'set_email', 'gina@localhost'), /real email/);
    const me = await call('gina', 'set_email', 'gina@uni.ac.uk');
    assert.equal(me.email, 'gina@uni.ac.uk');
  });
});

/** The date `years` ago today, as YYYY-MM-DD, moved by `days`. */
function yearsAgo(years, days = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('dates of birth', () => {
  test('signing up needs a real date of birth, which nobody can read', async () => {
    const { code } = await call('alice', 'create_invite');
    for (const born of [null, '', 'soon', '2001-02-30', '1899-12-31', yearsAgo(0, 1)]) {
      await rejects(signUp('ivy', code, { born }), /date of birth/, String(born));
    }
    await signUp('ivy', code, { born: yearsAgo(30) });
    assert.equal((await call('ivy', 'get_me')).under_18, false);
    for (const user of ['ivy', 'alice', 'anon']) {
      await rejects(asUser(user, 'select * from public.birthdays'), /permission denied/);
    }
  });

  test('players who joined before dates of birth count as grown-ups', async () => {
    await q('delete from public.birthdays where user_id = $1', [ids.alice]);
    assert.equal((await call('alice', 'get_me')).under_18, false);
  });

  test('under-18s have no cigarettes: none in the shed, from friends or stalls', async () => {
    const { code } = await call('alice', 'create_invite');
    await signUp('jay', code, { born: yearsAgo(18, 1) });
    let me = await call('jay', 'get_me');
    assert.equal(me.under_18, true);

    await setChips('jay', 100);
    const shop = await call('jay', 'get_shop');
    assert.equal(
      shop.items.some((i) => i.kind === 'cigarette'),
      false
    );
    assert.ok((await call('alice', 'get_shop')).items.some((i) => i.kind === 'cigarette'));
    await rejects(call('jay', 'buy', 'cigarette'), /over-18s/);
    await q('update public.profiles set tester = true where id = $1', [ids.jay]);
    await rejects(call('jay', 'dev_item', 'cigarette', 5), /over-18s/);
    await rejects(call('jay', 'smoke'), /over-18s/);

    // A friend can't give them any, or sell them any.
    await give('alice', 'cigarette', 5);
    await study(['alice', 'jay'], 50);
    const garden = await call('alice', 'offer_trade', 'jay', 'cigarette', 1, null, null);
    await rejects(call('jay', 'respond_trade', garden.trades[0].id, true), /over-18s/);
    await call('jay', 'respond_trade', garden.trades[0].id, false);
    const stall = await call('alice', 'list_item', 'cigarette', 2, 1);
    const chips = (await call('jay', 'get_me')).chips;
    await rejects(call('jay', 'buy_listing', stall.me.stall[0].id, 1), /over-18s/);
    me = await call('jay', 'get_me');
    assert.equal(me.inventory.cigarette, undefined);
    assert.equal(me.chips, chips);

    // On their 18th birthday, they're grown up.
    await q('update public.birthdays set born = $2 where user_id = $1', [ids.jay, yearsAgo(18)]);
    assert.equal((await call('jay', 'get_me')).under_18, false);
    await call('jay', 'buy', 'cigarette');
  });
});

describe('study invites', () => {
  test('an invite to your session: whoever joins with it studies with you, as your friend', async () => {
    await rejects(call('carol', 'invite_to_session'), /Start a session first/);
    await call('carol', 'start_session', 40);
    await travel(10);
    const invite = await call('carol', 'invite_to_session');
    const carol = await call('carol', 'get_me');
    assert.equal(invite.ends_at, carol.active_session.ends_at);
    const check = await call('anon', 'check_signup', invite.code, 'hal', 'hal@uni.ac.uk');
    assert.equal(check.ok, true);
    assert.equal(check.from, 'Carol');
    assert.equal(check.studying_until, carol.active_session.ends_at);

    await signUp('hal', invite.code);
    const used = await call('hal', 'use_invite', invite.code, 'page-h');
    assert.equal(used.from, 'Carol');
    assert.equal(used.session, true);
    assert.equal(used.joined, true);
    assert.equal(used.me.active_session.ends_at, carol.active_session.ends_at);
    assert.equal(used.me.active_session.device, 'page-h');
    assert.ok((await call('hal', 'get_friends_board')).some((f) => f.username === 'carol'));

    const again = await call('hal', 'use_invite', invite.code);
    assert.equal(again.joined, false);
    assert.match(again.note, /studying already/);
    await rejects(call('bob', 'use_invite', invite.code), /isn't valid/);
  });

  test('signed-in players can use any invite to become friends, and join if it is to a session', async () => {
    await q(
      `delete from public.friendships
       where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)`,
      [ids.alice, ids.carol]
    );
    await call('carol', 'start_session', 30);
    const invite = await call('carol', 'invite_to_session');
    await rejects(call('carol', 'use_invite', invite.code), /your own invite/);
    const used = await call('alice', 'use_invite', invite.code, 'page-a');
    assert.equal(used.joined, true);
    assert.equal(used.me.status, 'focused');
    assert.ok((await call('carol', 'get_friends_board')).some((f) => f.username === 'alice'));
    await call('alice', 'cancel_session');

    // Over by the time it's used: still friends, but nothing to join.
    await q('delete from public.invites where created_by = $1 and used_by is null', [ids.bob]);
    await call('bob', 'start_session', 30);
    const late = await call('bob', 'invite_to_session');
    await call('bob', 'cancel_session');
    const hal = await call('hal', 'use_invite', late.code);
    assert.equal(hal.joined, false);
    assert.match(hal.note, /Bob has finished that session/);
    assert.equal((await call('anon', 'check_signup', late.code, 'zed')).ok, false, 'used up');

    // A plain invite makes you friends too.
    const plain = await call('bob', 'create_invite');
    const gina = await call('gina', 'use_invite', plain.code);
    assert.equal(gina.session, false);
    assert.equal(gina.joined, false);
    assert.ok((await call('gina', 'get_friends_board')).some((f) => f.username === 'bob'));
  });
});
