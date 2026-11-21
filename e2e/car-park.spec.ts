import { button, expect, test, walk } from './test';

test('arriving by car: you drive in from the side, and park before you go in', async ({
  page,
  fake,
}) => {
  fake.me.vehicle = 'hatchback';
  await fake.open('/');
  await expect(page.getByText('You came by hatchback. Park it to go in.')).toBeVisible();
  await walk(page, 'ArrowUp', 600);
  // In the lane, not in a bay: nowhere to park yet, and no walking in.
  await expect(page.getByText('Drive into a free bay, straight on, to park.')).toBeVisible();
  await expect(button(page, 'Park here')).toBeHidden();
  await button(page, 'Walk in').click();
  await expect(page.getByText('Park first: drive into a free bay and stop.')).toBeVisible();
  expect(fake.called('park')).toEqual([]);
});

test('parking in a bay straightens you up, and you get out beside it', async ({ page, fake }) => {
  fake.atDesk();
  Object.assign(fake.me, { vehicle: 'hatchback', parked: { x: 150, y: 472, a: 0.2 } });
  await fake.open('/');
  // Out of the office door, and the car park's listening for the arrow keys.
  await expect(button(page, 'Go in')).toBeVisible();
  await walk(page, 'ArrowDown', 3000, button(page, 'Get in'));
  await button(page, 'Get in').click();
  // Already in bay 9, near enough straight: stopped there, you can park.
  await button(page, 'Park here').click();
  await expect.poll(() => fake.called('park')).toHaveLength(1);
  expect(fake.called('park')[0]).toEqual({ p_x: 152, p_y: 469, p_a: 0 });
  await expect(button(page, 'Get in')).toBeVisible();
});

test('a bike goes in the rack: get on, and park it there', async ({ page, fake }) => {
  fake.atDesk();
  Object.assign(fake.me, { vehicle: 'bike', parked: { x: 41.2, y: 202, a: 0 } });
  await fake.open('/');
  // Out of the office door, and the car park's listening for the arrow keys.
  await expect(button(page, 'Go in')).toBeVisible();
  await walk(page, 'ArrowLeft', 2500, button(page, 'Get on'));
  await button(page, 'Get on').click();
  await button(page, 'Park here').click();
  await expect.poll(() => fake.called('park')).toHaveLength(1);
  expect(fake.called('park')[0]).toEqual({ p_x: 41.2, p_y: 202, p_a: 0 });
});

test("driving into a friend's car damages both, and says they can claim", async ({
  page,
  fake,
}) => {
  fake.me.vehicle = 'hatchback';
  Object.assign(fake.friends[0], {
    status: 'idle',
    place: 'outside',
    vehicle: 'hatchback',
    parked: { x: 250, y: 379, a: Math.PI / 2 },
  });
  await fake.open('/');
  await walk(page, 'ArrowUp', 1500);
  await expect.poll(() => fake.called('crash')).toHaveLength(1);
  const [crash] = fake.called('crash');
  expect(crash.p_username).toBe('bob');
  expect(Number(crash.p_speed)).toBeGreaterThan(18);
  await expect(page.getByText("Crunch. You drove into Bob's hatchback.")).toBeVisible();
  await expect(
    page.getByText("You drove into Bob's hatchback. They can claim damages from you.")
  ).toBeVisible();
});

test('walking out of the office, you can walk away from the door', async ({ page, fake }) => {
  fake.atDesk();
  await fake.open('/office');
  await button(page, 'Walk out').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await walk(page, 'ArrowDown', 600);
  await walk(page, 'ArrowLeft', 300);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe('/');
  // And back up through the door, you're in.
  await walk(page, 'ArrowRight', 300);
  await walk(page, 'ArrowUp', 1500);
  await expect(page).toHaveURL(/\/office/);
});

test("tapping a friend's car shows its health", async ({ page, fake }) => {
  fake.atDesk();
  Object.assign(fake.friends[0], {
    status: 'idle',
    vehicle: 'estate',
    vehicle_health: 70,
    parked: { x: 300, y: 300, a: 0.2 },
  });
  await fake.open('/');
  await button(page, "Bob's estate car").click();
  await expect(page.getByText('Health 70 / 100')).toBeVisible();
  await expect(page.getByText(/Someone has bumped into it/)).toBeVisible();
});

test('claiming damages for a bump, or letting it go', async ({ page, fake }) => {
  fake.atDesk();
  Object.assign(fake.me, { vehicle: 'hatchback', vehicle_health: 80 });
  fake.me.crashes = [fake.crashOf('bob', 'Bob', 'nate', 'Nate', 'hatchback', 20)];
  await fake.open('/');
  await expect(
    page.getByText('Bob drove into your hatchback: 20 damage, which costs 30 chips to put right.')
  ).toBeVisible();
  await button(page, 'Claim from Bob').click();
  await expect
    .poll(() => fake.called('claim_crash'))
    .toEqual([{ p_id: fake.me.crashes[0].id, p_claim: true }]);
  await expect(button(page, 'Claim from Bob')).toBeHidden();
  expect(fake.me.vehicle_health).toBe(100);
});

test('smoking in the car park', async ({ page, fake }) => {
  fake.atDesk();
  fake.me.inventory = { cigarette: 2 };
  await fake.open('/');
  await button(page, 'Smoke a cigarette (2 left)').click();
  await expect(button(page, 'Smoke a cigarette (1 left)')).toBeDisabled();
  expect(fake.called('smoke')).toHaveLength(1);
});

test('buying a car suggests insurance, and the shed repairs it', async ({ page, fake }) => {
  fake.me.chips = 400;
  fake.shop.push({
    slug: 'hatchback',
    kind: 'vehicle',
    name: 'Hatchback',
    price: 300,
    pack_size: 1,
    owned: 0,
    grow_hours: null,
    yield: null,
  });
  await fake.open('/shop');
  await button(page, 'Buy Hatchback for 300 chips').click();
  await expect(page.getByText(/Bumps happen in the car park/)).toBeVisible();
  await button(page, 'Insure your hatchback for 7 days, 30 chips').click();
  await expect(page.getByText(/Insured until/)).toBeVisible();
  expect(fake.called('buy_insurance')).toHaveLength(1);

  fake.me.vehicle_health = 60;
  await page.reload();
  await expect(page.getByText('Your hatchback: health 60 / 100.')).toBeVisible();
  await button(page, 'Repair your hatchback for 60 chips').click();
  await expect(page.getByText('Your hatchback: not a scratch on it.')).toBeVisible();
});

test('on foot, walking about is arriving', async ({ page, fake }) => {
  await fake.open('/');
  await expect(page.getByText('You came on foot. The garden shed sells bikes.')).toBeVisible();
  await walk(page, 'ArrowLeft', 400);
  await expect.poll(() => fake.called('set_place')).toContainEqual({ p_place: 'outside' });
});

test('driving into a lamp post damages your own vehicle', async ({ page, fake }) => {
  fake.atDesk();
  // Nose down in the bottom row's first bay, just above a lamp post.
  Object.assign(fake.me, { vehicle: 'hatchback', parked: { x: 40, y: 469, a: Math.PI } });
  await fake.open('/');
  await expect(button(page, 'Go in')).toBeVisible();
  // Down to the bottom row, then along to it.
  await walk(page, 'ArrowDown', 3000);
  await walk(page, 'ArrowLeft', 2500, button(page, 'Get in'));
  await button(page, 'Get in').click();
  await walk(page, 'ArrowUp', 1500);
  await expect.poll(() => fake.called('bump')).toHaveLength(1);
  expect(Number(fake.called('bump')[0].p_speed)).toBeGreaterThan(18);
  await expect(page.getByText('Bang. You drove into a lamp post.')).toBeVisible();
  expect(fake.me.vehicle_health).toBeLessThan(100);
});

test('on a computer, the keys to press are where the thumbstick would be', async ({
  page,
  fake,
}) => {
  fake.me.vehicle = 'hatchback';
  await fake.open('/');
  await expect(page.getByLabel(/Drive with W and S, and steer with A and D/)).toBeVisible();
  await expect(page.getByText('A D steer', { exact: false })).toBeVisible();
});

test('under-18s have nothing to smoke', async ({ page, fake }) => {
  fake.atDesk();
  fake.me.under_18 = true;
  await fake.open('/');
  await expect(button(page, 'Go in')).toBeVisible();
  await expect(page.getByRole('button', { name: /Smoke a cigarette/ })).toHaveCount(0);
});
