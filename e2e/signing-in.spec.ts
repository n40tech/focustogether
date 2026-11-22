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
  await page.getByPlaceholder('Date of birth (DD/MM/YYYY)').fill('01041999');
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
        born: '1999-04-01',
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
  await page.getByPlaceholder('Date of birth (DD/MM/YYYY)').fill('01041999');
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
        born: '1999-04-01',
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
  await button(page, 'Start the sound').click();
  await button(page, 'Mute').click();
  await button(page, 'Unmute').click();
  await expect(button(page, 'Mute')).toBeVisible();
});

test('settings: a slider for each kind of sound, kept for next time', async ({ page, fake }) => {
  await fake.open('/');
  await button(page, 'Settings').click();
  const traffic = page.getByRole('slider', { name: 'Traffic' });
  await expect(traffic).toHaveAttribute('aria-valuenow', '100');
  // All the way to the left: no traffic.
  await traffic.click({ position: { x: 2, y: 16 } });
  await expect(traffic).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('switch', { name: 'Keep playing when you leave' }).click();
  await button(page, 'Close').last().click();

  await page.reload();
  await button(page, 'Settings').click();
  await expect(page.getByRole('slider', { name: 'Traffic' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('slider', { name: 'Overall' })).toHaveAttribute(
    'aria-valuenow',
    '80'
  );
  await expect(page.getByRole('switch', { name: 'Keep playing when you leave' })).not.toBeChecked();
});

test('logging out on a break counts as going home', async ({ page, fake }) => {
  fake.onBreak();
  await fake.open('/');
  await expect(page.getByText(/You're on a break/)).toBeVisible();
  await button(page, 'Settings').click();
  await button(page, 'Log out').click();

  await expect(button(page, 'Arrive')).toBeVisible();
  const home = fake.calls.findIndex((c) => c.fn === 'go_home');
  expect(fake.calls[home]?.status).toBe('on_break');
  expect(home).toBeLessThan(fake.calls.findIndex((c) => c.fn === 'logout'));
  expect(fake.me.status).toBe('absent');
});

test('joining needs a real date of birth', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open(`/login?invite=${INVITE}`);
  await page.getByPlaceholder('Username (how friends find you)').fill('nate');
  await page.getByPlaceholder('Email (for news; never shown)').fill('nate@studymail.co.uk');
  const born = page.getByPlaceholder('Date of birth (DD/MM/YYYY)');
  await born.fill('31022009');
  await expect(born).toHaveValue('31/02/2009');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();
  await expect(
    page.getByText('Write your date of birth as day, month and year: 14/03/2009')
  ).toBeVisible();
  expect(fake.called('signup')).toEqual([]);

  await born.fill('14/03/2009');
  await button(page, 'Join').click();
  await expect(button(page, 'Walk in')).toBeVisible();
  expect(fake.called('signup')).toEqual([
    expect.objectContaining({ data: expect.objectContaining({ born: '2009-03-14' }) }),
  ]);
});
