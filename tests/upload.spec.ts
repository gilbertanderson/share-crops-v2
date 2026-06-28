import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { setupAuthenticatedSession } from './fixtures';

const TEST_PHOTO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/1x1.png');

test.describe('Photo upload', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedSession(page);
  });

  test('returns a stable same-origin /images/ URL (Netlify Blobs shape)', async ({ page }) => {
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'List Your Produce' })).toBeVisible();

    const uploadResponse = page.waitForResponse(
      (res) => res.url().includes('/upload') && res.request().method() === 'POST' && res.ok(),
    );
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(TEST_PHOTO);

    const res = await uploadResponse;
    const body = (await res.json()) as { url?: string };
    expect(body.url).toMatch(/\/images\/mock-/);
    expect(body.url).not.toMatch(/supabase\.co\/storage\/v1\/object\/sign/);

    const preview = page.locator('img[src*="/images/"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /\/images\/mock-/);
  });
});
