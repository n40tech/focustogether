import { button, expect, test, walk } from './test';

test('arriving by car: drive in, park where you like, and get out', async ({ page, fake }) => {
  fake.me.vehicle = 'hatchback';
  await fake.open('/');
  await expect(page.getByText("You came by hatchback. Park wherever there's room.")).toBeVisible();

  await walk(page, 'ArrowUp', 1200);
  await expect(button(page, 'Get out here')).toBeVisible({ timeout: 5000 });
  await button(page, 'Get out here').click();
  await expect.poll(() => fake.called('park')).toHaveLength(1);
  const [parked] = fake.called('park');
  // Up from the road into the car park, still facing up.
  expect(parked.p_x).toBeCloseTo(680, 0);
  expect(Number(parked.p_y)).toBeLessThan(560);
  expect(Math.abs(Number(parked.p_a))).toBeLessThan(0.01);
  await expect(button(page, 'Get in')).toBeVisible();
  expect(fake.me.status).toBe('idle');
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
    parked: { x: 680, y: 490, a: 0 },
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
