import { ALL_TIPS } from './fake-supabase';
import { button, expect, test, walk } from './test';

test('a first day: tips, then skipping the first session to see the garden', async ({
  page,
  fake,
}) => {
  Object.assign(fake.me, {
    sessions_done: 0,
    sessions_studied: 0,
    tips: [],
    inventory: { radish_seeds: 3 },
  });
  await fake.open('/');
  await expect(page.getByText(/Welcome to Focus Together/)).toBeVisible();

  await button(page, 'Walk in').click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByText(/Pick how long to study and press Start/)).toBeVisible();
  // Walking in was what the welcome tip asked.
  await expect.poll(() => fake.called('done_tip')).toContainEqual({ p_tip: 'welcome' });
  expect(fake.called('done_tip').every((args) => args.p_tip === 'welcome')).toBe(true);

  await button(page, 'Start 25 min').click();
  const stay = page.getByText(/You can leave the page while you study/);
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
  // A skipped session wasn't studied, so it's too soon to suggest inviting friends.
  await expect(page.getByText(/Make an invite on the Friends board/)).toBeHidden();
});

test('after a studied session, a tip suggests inviting friends', async ({ page, fake }) => {
  fake.onBreak();
  Object.assign(fake.me, {
    sessions_done: 1,
    sessions_studied: 1,
    tips: ALL_TIPS.filter((t) => t !== 'invite'),
  });
  await fake.open('/garden');
  const invite = page.getByText(/Make an invite on the Friends board/);
  await expect(invite).toBeVisible();

  await fake.open('/');
  await expect(invite).toBeVisible();
  await button(page, 'Got it: hide this tip').click();
  await expect(invite).toBeHidden();
  expect(fake.called('done_tip')).toEqual([{ p_tip: 'invite' }]);
});

test('a skipped first session is not enough for the invite tip', async ({ page, fake }) => {
  Object.assign(fake.me, {
    sessions_done: 1,
    sessions_studied: 0,
    tips: ALL_TIPS.filter((t) => t !== 'invite'),
  });
  await fake.open('/');
  await expect(button(page, 'Walk in')).toBeVisible();
  await expect(page.getByText(/Make an invite on the Friends board/)).toBeHidden();
});
