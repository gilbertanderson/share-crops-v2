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

test('fails over to Supabase Edge with the anon apikey when Vercel API tiers fail', async ({ page }) => {
  const edgeRequests: Array<{ url: string; apikey?: string }> = [];

  await setupAuthenticatedSession(page, {
    primaryFails: true,
    fallbackFails: true,
    onSupabaseEdgeRequest: (request) => {
      edgeRequests.push({
        url: request.url(),
        apikey: request.headers().apikey,
      });
    },
  });

  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.locator('.listing-card:has-text("Heirloom Tomatoes")')).toBeVisible();

  expect(edgeRequests.some((request) => request.url.includes('/auth/me'))).toBe(true);
  expect(edgeRequests.length).toBeGreaterThan(0);
  expect(edgeRequests.every((request) => request.apikey === 'test-supabase-anon-key')).toBe(true);
});
