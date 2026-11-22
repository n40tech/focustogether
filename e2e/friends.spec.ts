import { iso } from './fake-supabase';
import { button, expect, test } from './test';

test('unpinning a friend asks first, then takes them off the board', async ({ page, fake }) => {
  await fake.open('/friends');
  await expect(page.getByText('@bob')).toBeVisible();

  await button(page, 'Unpin Bob').click();
  await expect(page.getByText(/Take Bob off your board\?/)).toBeVisible();
  await button(page, 'Keep').click();
  await expect(page.getByText(/Take Bob off your board\?/)).toBeHidden();
  expect(fake.called('remove_friend')).toEqual([]);

  await button(page, 'Unpin Bob').click();
  await button(page, 'Yes, unpin Bob').click();
  await expect(page.getByText('@bob')).toBeHidden();
  await expect(page.getByText('No friends yet. Ask someone by their username.')).toBeVisible();
  expect(fake.called('remove_friend')).toEqual([{ p_username: 'bob' }]);
});

test('only invites still waiting to be used are on the board', async ({ page, fake }) => {
  fake.invites = [
    { code: 'K7QM4XPA', expires_at: iso(14 * 24 * 60), used_by: null, used_at: null },
    { code: 'B3RN7WQZ', expires_at: iso(10 * 24 * 60), used_by: 'Carol', used_at: iso(-60) },
  ];
  await fake.open('/friends');
  await expect(page.getByText('K7QM-4XPA')).toBeVisible();
  await expect(page.getByText('B3RN-7WQZ')).toBeHidden();
  await expect(page.getByText('Carol joined')).toBeHidden();
});

test('asking someone to be friends, then withdrawing', async ({ page, fake }) => {
  await fake.open('/friends');
  await page.getByPlaceholder("Friend's username").fill('Carol');
  await button(page, 'Ask').click();
  await expect(
    page.getByText("Asked @carol. They'll be on your board once they say yes.")
  ).toBeVisible();
  await expect(page.getByText('Asked @carol. Waiting for them to say yes.')).toBeVisible();
  expect(fake.called('add_friend')).toEqual([{ p_username: 'Carol' }]);

  await button(page, 'Withdraw your request to Carol').click();
  await expect(page.getByText('Asked @carol. Waiting for them to say yes.')).toBeHidden();
  expect(fake.called('withdraw_friend_request')).toEqual([{ p_username: 'carol' }]);
});

test('saying yes to someone who asked puts them on the board', async ({ page, fake }) => {
  fake.requests.to_you = [{ username: 'dave', display_name: 'Dave', via: ['Bob', 'Carol'] }];
  await fake.open('/friends');
  await expect(page.getByText('Would like to be friends')).toBeVisible();
  await expect(page.getByText('@dave · friends with Bob and Carol')).toBeVisible();

  await button(page, 'Accept Dave').click();
  await expect(page.getByText('Would like to be friends')).toBeHidden();
  await expect(page.getByText('@dave', { exact: true })).toBeVisible();
  expect(fake.called('answer_friend_request')).toEqual([{ p_username: 'dave', p_accept: true }]);
});

test("the car park says when someone's asked", async ({ page, fake }) => {
  fake.requests.to_you = [{ username: 'dave', display_name: 'Dave', via: [] }];
  await fake.open('/');
  await expect(
    page.getByText('Someone would like to be friends. Answer on the Friends board.')
  ).toBeVisible();
  await button(page, 'Friends').click();
  await expect(page).toHaveURL(/\/friends/);
  await expect(page.getByText('Would like to be friends')).toBeVisible();
});

test("tapping a friend shows what they've studied and what they're worth", async ({
  page,
  fake,
}) => {
  await fake.open('/friends');
  await button(page, "Bob's profile").click();
  await expect(page.getByText('1,250 minutes')).toBeVisible();
  await expect(page.getByText('1,420')).toBeVisible();
  await expect(page.getByText('Net worth')).toBeVisible();
  await expect(page.getByText('6, 2 in common')).toBeVisible();
  await expect(page.getByText('45 minutes ago')).toBeVisible();
  expect(fake.called('get_profile')).toEqual([{ p_username: 'bob' }]);
});

test("a friend of a friend's car is in their bay, and tapping it asks", async ({ page, fake }) => {
  fake.friendsOfFriends = [
    {
      username: 'dave',
      display_name: 'Dave',
      status: 'focused',
      place: 'office',
      arrived_at: iso(-10),
      vehicle: 'hatchback',
      vehicle_health: 100,
      parked: null,
      desk_items: [{ item: 'duck', x: 36, y: -26 }],
      desk: 2,
      via: ['Bob'],
    },
  ];
  await fake.open('/');
  await button(page, "Bob's friend's car").click();
  await expect(page.getByText('1 friend in common: Bob')).toBeVisible();
  await expect(button(page, 'Ask to be friends')).toBeVisible();
});

test('turning notifications on, and off again', async ({ page, fake }) => {
  // The browser's push service, as far as the app can tell.
  await page.addInitScript(() => {
    const sub = {
      endpoint: 'https://push.example/nate',
      toJSON: () => ({ endpoint: 'https://push.example/nate', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => {
        mine = null;
        return true;
      },
    };
    let mine: typeof sub | null = null;
    const registration = {
      pushManager: { getSubscription: async () => mine, subscribe: async () => (mine = sub) },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: async () => registration,
        getRegistration: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
    let permission = 'default';
    Object.assign(window, {
      PushManager: function PushManager() {},
      Notification: {
        get permission() {
          return permission;
        },
        requestPermission: async () => (permission = 'granted'),
      },
    });
  });
  await fake.open('/friends');
  await button(page, 'Turn on').click();
  await expect(page.getByText(/^On for this device/)).toBeVisible();
  expect(fake.called('save_push')).toEqual([
    { p_endpoint: 'https://push.example/nate', p_p256dh: 'p', p_auth: 'a' },
  ]);

  await button(page, 'Turn off').click();
  await expect(button(page, 'Turn on')).toBeVisible();
  expect(fake.called('drop_push')).toEqual([{ p_endpoint: 'https://push.example/nate' }]);
});
