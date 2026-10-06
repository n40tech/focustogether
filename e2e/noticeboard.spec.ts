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
  await expect(page.getByText('No friends yet. Add someone by their username.')).toBeVisible();
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
