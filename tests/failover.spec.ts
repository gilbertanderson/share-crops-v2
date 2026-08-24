import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './fixtures';

const primaryFailureCases = [
  { name: '5xx', primaryFailureMode: '5xx' },
  { name: '404', primaryFailureMode: '404' },
  { name: 'HTML app shell', primaryFailureMode: 'html' },
] as const;

// When the primary same-origin API errors or returns an app shell instead of
// JSON, the app transparently fails over to VITE_FALLBACK_API_URL.
for (const { name, primaryFailureMode } of primaryFailureCases) {
  test(`fails over to the backup API when the primary returns ${name}`, async ({ page }) => {
    let fallbackHit = false;
    page.on('request', (req) => {
      if (req.url().includes('fallback.test/api/make-server-dd877831')) fallbackHit = true;
    });

    await setupAuthenticatedSession(page, { primaryFailureMode });

    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    await expect(page.locator('.listing-card:has-text("Heirloom Tomatoes")')).toBeVisible();
    expect(fallbackHit).toBe(true);
  });
}
