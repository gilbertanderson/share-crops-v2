import { test, expect, type Page } from '@playwright/test';
import { setupAuthenticatedSession } from './fixtures';

// When the primary same-origin API errors, the app transparently fails over to
// VITE_FALLBACK_API_URL (fallback.test in Playwright).
test('fails over to the backup API when the primary returns 5xx', async ({ page }) => {
  await expectBackupApiFailover(page, { primaryFails: true });
});

test('fails over to the backup API when the primary returns 404', async ({ page }) => {
  await expectBackupApiFailover(page, { primaryStatus: 404 });
});

test('fails over to the backup API when the primary serves HTML', async ({ page }) => {
  await expectBackupApiFailover(page, { primaryReturnsHtml: true });
});

async function expectBackupApiFailover(
  page: Page,
  opts: Parameters<typeof setupAuthenticatedSession>[1],
) {
  let fallbackHit = false;
  page.on('request', (req) => {
    if (req.url().includes('fallback.test/api/make-server-dd877831')) fallbackHit = true;
  });

  await setupAuthenticatedSession(page, opts);

  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.locator('.listing-card:has-text("Heirloom Tomatoes")')).toBeVisible();
  expect(fallbackHit).toBe(true);
}
