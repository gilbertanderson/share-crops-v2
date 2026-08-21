import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './fixtures';

// When the primary same-origin API errors, the app transparently fails over to
// VITE_FALLBACK_API_URL (fallback.test in Playwright).
test('fails over to the backup API when the primary returns 5xx', async ({ page }) => {
  let fallbackHit = false;
  page.on('request', (req) => {
    if (req.url().includes('fallback.test/api/make-server-dd877831')) fallbackHit = true;
  });

  await setupAuthenticatedSession(page, { primaryFails: true });

  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.locator('.listing-card:has-text("Heirloom Tomatoes")')).toBeVisible();
  expect(fallbackHit).toBe(true);
});

test('does not replay a failed mutating request to the backup API', async ({ page }) => {
  let fallbackListingWrites = 0;
  page.on('request', (req) => {
    if (
      req.method() === 'POST' &&
      req.url().includes('fallback.test/api/make-server-dd877831/listings')
    ) {
      fallbackListingWrites += 1;
    }
  });

  await setupAuthenticatedSession(page, { primaryFails: true });
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByPlaceholder('e.g., Fresh Tomatoes').fill('Kale bunches');
  await page.getByPlaceholder('10 lbs').fill('3 bunches');
  await page.getByPlaceholder('Tell others about it…').fill('Tender kale harvested today.');

  const failedCreate = page.waitForResponse(
    (res) => res.url().includes('/api/make-server-dd877831/listings') &&
      res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create Listing' }).click();
  const response = await failedCreate;
  expect(response.ok()).toBe(false);

  expect(fallbackListingWrites).toBe(0);
});
