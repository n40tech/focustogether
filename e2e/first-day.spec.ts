import { button, expect, test, walk } from './test';

test('a first day: tips, then skipping the first session to see the garden', async ({
  page,
  fake,
}) => {
  Object.assign(fake.me, { sessions_done: 0, tips: [], inventory: { radish_seeds: 3 } });
  await fake.open('/');
  await expect(page.getByText(/Welcome to Focus/)).toBeVisible();

  await button(page, 'Walk in').click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByText(/Pick how long to study and press Start/)).toBeVisible();
  // Walking in was what the welcome tip asked.
  await expect.poll(() => fake.called('done_tip')).toContainEqual({ p_tip: 'welcome' });
  expect(fake.called('done_tip').every((args) => args.p_tip === 'welcome')).toBe(true);

  await button(page, 'Start 25 min').click();
  const stay = page.getByText(/Keep this tab open while you study/);
  await expect(stay).toBeVisible();
  await button(page, 'Got it: hide this tip').click();
  await expect(stay).toBeHidden();

  await button(page, 'Skip my first session').click();
  await expect(page).toHaveURL(/\/payout$/);
  await expect(page.getByText('+26 chips')).toBeVisible();
  expect(fake.called('skip_first_session')).toHaveLength(1);

  await button(page, 'Take a break').click();
  await expect(page).toHaveURL(/\/garden$/);
  const walkTip = page.getByText(/Drag the stick/);
  await expect(walkTip).toBeVisible();
  // A few steps, and you've got the hang of it.
  await walk(page, 'ArrowLeft', 2600);
  await expect(walkTip).toBeHidden();
  expect(fake.called('done_tip')).toContainEqual({ p_tip: 'walk' });
  await expect(page.getByText(/Walk up to one of your beds to plant/)).toBeVisible();
});
