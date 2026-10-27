import { INVITE } from './fake-supabase';
import { button, expect, pathOf, test } from './test';

test('joining with an invite link', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open(`/login?invite=${INVITE}`);
  await expect(page.getByText('Alice invited you.')).toBeVisible();

  const username = page.getByPlaceholder('Username (how friends find you)');
  await username.fill('Nate!');
  await page.getByPlaceholder('Your name (shown to friends)').fill('Nate');
  await page.getByPlaceholder('Email (for news; never shown)').fill('nate@studymail.co.uk');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();
  await expect(
    page.getByText('Usernames are 3 to 20 letters, numbers or _. Accents are fine')
  ).toBeVisible();

  await username.fill('nate');
  await button(page, 'Join').click();
  await expect(button(page, 'Walk in')).toBeVisible();
  expect(fake.called('signup')).toEqual([
    expect.objectContaining({
      email: 'nate@focus.test',
      data: {
        invite: INVITE,
        username: 'nate',
        display_name: 'Nate',
        contact_email: 'nate@studymail.co.uk',
      },
    }),
  ]);
});

test('a username can have accents; the account email is its plain spelling', async ({
  page,
  fake,
}) => {
  fake.signedIn = false;
  await fake.open(`/login?invite=${INVITE}`);
  await page.getByPlaceholder('Username (how friends find you)').fill(' Zoë_Straße ');
  await page.getByPlaceholder('Email (for news; never shown)').fill('nate@studymail.co.uk');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();
  await expect(button(page, 'Walk in')).toBeVisible();
  expect(fake.called('signup')).toEqual([
    expect.objectContaining({
      email: 'zoe_strasse@focus.test',
      data: {
        invite: INVITE,
        username: 'zoë_straße',
        display_name: 'Zoë_Straße',
        contact_email: 'nate@studymail.co.uk',
      },
    }),
  ]);
});

test('signing in with a username', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open('/login');
  await page.getByPlaceholder('Username').fill('nate');
  await page.getByPlaceholder('Password').fill('hunter2');
  await button(page, 'Arrive').click();

  await expect(button(page, 'Walk in')).toBeVisible();
  expect(pathOf(page)).toBe('/');
  expect(fake.called('token')).toEqual([
    expect.objectContaining({ email: 'nate@focus.test', password: 'hunter2' }),
  ]);
  await expect(page.getByText('You came on foot. The garden shed sells bikes.')).toBeVisible();
});

test('the first tap turns the sound on', async ({ page, fake }) => {
  await fake.open('/');
  const sound = button(page, 'Mute');
  await expect(sound).toHaveText('– Sound');
  await sound.click();
  await expect(sound).toHaveText('♪ Sound on');
  await sound.click();
  await expect(button(page, 'Unmute')).toHaveText('– Muted');
});

test('logging out on a break counts as going home', async ({ page, fake }) => {
  fake.onBreak();
  await fake.open('/');
  await expect(page.getByText(/You're on a break/)).toBeVisible();
  await button(page, 'Log out').click();

  await expect(button(page, 'Arrive')).toBeVisible();
  const home = fake.calls.findIndex((c) => c.fn === 'go_home');
  expect(fake.calls[home]?.status).toBe('on_break');
  expect(home).toBeLessThan(fake.calls.findIndex((c) => c.fn === 'logout'));
  expect(fake.me.status).toBe('absent');
});
