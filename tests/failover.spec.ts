import { test, expect } from '@playwright/test';
import { mockBackend, seedAuth } from './fixtures';

// The headline feature: when the primary same-origin API errors, the app
// transparently fails over to the backup deployment (VITE_FALLBACK_API_URL).
test('fails over to the backup API when the primary returns 5xx', async ({ page }) => {
  await seedAuth(page);
  // Primary returns 500 for every call; the fallback host serves the data.
  await mockBackend(page, { primaryFails: true });

  // Track that the fallback host actually received traffic.
  let fallbackHit = false;
  page.on('request', (req) => {
    if (req.url().includes('fallback.test/api/make-server-dd877831')) fallbackHit = true;
  });

  await page.goto('/marketplace');

  // App still boots (auth resolved via fallback) and renders fallback data.
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.locator('.listing-card:has-text("Heirloom Tomatoes")')).toBeVisible();
  expect(fallbackHit).toBe(true);
});
