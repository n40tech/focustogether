import { STUDY_INVITE } from './fake-supabase';
import { button, expect, pathOf, test } from './test';

test('while you study, an invite link asks someone to study with you', async ({ page, fake }) => {
  fake.studying(50);
  fake.me.active_session!.device = null;
  await fake.open('/office');
  await button(page, 'Invite someone to study with you').click();
  await expect.poll(() => fake.called('invite_to_session')).toHaveLength(1);
  // Copied where the browser allows it, else the link itself.
  await expect(page.getByText(/Link copied|login\?invite=STUDY100/)).toBeVisible();
});

test('someone new opens the link, joins, and studies with you', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open(`/login?invite=${STUDY_INVITE}`);
  await expect(page.getByText(/Bob invited you to study with them, until/)).toBeVisible();
  await page.getByPlaceholder('Username (how friends find you)').fill('nate');
  await page.getByPlaceholder('Email (for news; never shown)').fill('nate@studymail.co.uk');
  await page.getByPlaceholder('Date of birth (DD/MM/YYYY)').fill('01041999');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();

  await expect(page.getByText("You're studying with Bob now, as friends.")).toBeVisible();
  await expect(page.getByText('Studying · 40 min', { exact: true })).toBeVisible();
  expect(pathOf(page)).toBe('/office');
  expect(fake.called('use_invite')).toEqual([
    { p_code: STUDY_INVITE, p_device: expect.any(String) },
  ]);
});

test('a player already signed in opens the link and joins straight away', async ({
  page,
  fake,
}) => {
  await fake.open(`/login?invite=${STUDY_INVITE}`);
  await expect(page.getByText("You're studying with Bob now, as friends.")).toBeVisible();
  expect(pathOf(page)).toBe('/office');
  expect(fake.called('use_invite')).toHaveLength(1);
});

test('signing up needs a real email', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open(`/login?invite=${STUDY_INVITE}`);
  await page.getByPlaceholder('Username (how friends find you)').fill('nate');
  await page.getByPlaceholder('Email (for news; never shown)').fill('nate@focus.test');
  await page.getByPlaceholder('Date of birth (DD/MM/YYYY)').fill('01041999');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();
  await expect(page.getByText("That doesn't look like a real email address")).toBeVisible();
  expect(fake.called('signup')).toEqual([]);
});

test('players who joined before can add their email on the Friends board', async ({
  page,
  fake,
}) => {
  fake.me.email = null;
  fake.me.tips = fake.me.tips.filter((t) => t !== 'email');
  await fake.open('/');
  await expect(page.getByText(/Add your email on the Friends board/)).toBeVisible();
  await button(page, 'Add it').click();
  await page.getByLabel('Your email').fill('Nate@Uni.ac.uk');
  await button(page, 'Save').click();
  await expect(page.getByText(/News of Focus Together goes to nate@uni.ac.uk/)).toBeVisible();
  expect(fake.called('set_email')).toEqual([{ p_email: 'Nate@Uni.ac.uk' }]);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('by default, leaving the page mid-session is fine', async ({ page, fake }) => {
    fake.atDesk();
    await fake.open('/office');
    await expect(page.getByRole('switch', { name: 'Hard mode' })).not.toBeChecked();
    await button(page, 'Start 25 min').click();
    const studying = page.getByText('Studying · 25 min', { exact: true });
    await expect(studying).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(60_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(studying).toBeVisible();
    expect(fake.called('leave_page')).toEqual([]);
    expect(fake.called('back_to_page')).toEqual([]);
  });
});
