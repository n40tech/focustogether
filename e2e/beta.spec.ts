import type { Page } from '@playwright/test';

import { button, expect, test } from './test';

const GROUP = 'https://chat.whatsapp.com/IYT1ETYTHwMBu0acq2Fq0t';
const banner = (page: Page) => page.getByRole('link', { name: /This is a beta test/ });

test('the beta banner opens the WhatsApp group in a new tab', async ({ page, fake }) => {
  fake.signedIn = false;
  await fake.open('/login');
  await expect(banner(page)).toHaveAttribute('href', GROUP);
  await expect(banner(page)).toHaveAttribute('target', '_blank');
  await expect(banner(page)).toHaveAttribute('rel', /noopener/);
});

test('the beta banner is everywhere but the office', async ({ page, fake }) => {
  await fake.open('/');
  await expect(banner(page)).toBeVisible();
  await button(page, 'Walk in').click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(banner(page)).toHaveCount(0);
});
