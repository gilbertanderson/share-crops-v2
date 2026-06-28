import { test } from '@playwright/test';
import { setupAuthenticatedSession } from './fixtures';

test('create listing sheet', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 940 });
  await setupAuthenticatedSession(page);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/v2-create.png' });
});
