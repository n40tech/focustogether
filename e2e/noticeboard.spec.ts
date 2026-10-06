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
