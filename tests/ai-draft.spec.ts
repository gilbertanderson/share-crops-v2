import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';
import { ensureVerifiedEmulatorUser, signInViaUi } from './firebase-emulator';

const PASSWORD = 'Test123456!';

test.describe('AI listing draft', () => {
  test.beforeEach(async ({ page }) => {
    const email = `draft+${Date.now()}@example.com`;
    await ensureVerifiedEmulatorUser(email, PASSWORD);
    await mockBackend(page);
    await signInViaUi(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/marketplace$/, { timeout: 15_000 });
  });

  test('fills the description when Draft with AI succeeds', async ({ page }) => {
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'List Your Produce' })).toBeVisible();

    await page.getByPlaceholder('e.g., Fresh Tomatoes').fill('Heirloom Tomatoes');
    await page.getByPlaceholder('10 lbs').fill('6 lbs');
    await page.getByRole('button', { name: '✨ Draft with AI' }).click();

    await expect(page.getByText('Draft added — tweak it to taste')).toBeVisible();
    const description = page.getByPlaceholder('Tell others about it…');
    await expect(description).toHaveValue(/fresh heirloom tomatoes/i);
  });

  test('shows a clear message when the draft endpoint is not configured', async ({ page }) => {
    await page.route('**/fallback.test/api/make-server-dd877831/listings/draft-description', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'AI assistant is not configured — set ANTHROPIC_API_KEY on the server' }),
      });
    });

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByPlaceholder('e.g., Fresh Tomatoes').fill('Basil');
    await page.getByRole('button', { name: '✨ Draft with AI' }).click();

    await expect(page.getByText(/AI drafting is not set up/i)).toBeVisible();
  });

  test('keeps the draft button disabled until a title is entered', async ({ page }) => {
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const draftBtn = page.getByRole('button', { name: '✨ Draft with AI' });
    await expect(draftBtn).toBeDisabled();
    await page.getByPlaceholder('e.g., Fresh Tomatoes').fill('Kale');
    await expect(draftBtn).toBeEnabled();
  });
});
