import { test, expect } from '@playwright/test';
import { mockBackend, seedAuth } from './fixtures';

// "Heirloom Tomatoes" appears both in the trending panel and as a listing card,
// so card assertions are scoped to .listing-card to stay unambiguous.
const card = (name: string) => `.listing-card:has-text("${name}")`;

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockBackend(page);
});

test('renders the marketplace with listings and community context', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.getByText(/Eastside Growers · ZIP 98112 · 184 members/)).toBeVisible();
  await expect(page.locator(card('Heirloom Tomatoes'))).toBeVisible();
  await expect(page.locator(card('Fresh Eggs'))).toBeVisible();
});

test('opens a listing detail from a card', async ({ page }) => {
  await page.goto('/marketplace');
  await page.locator(card('Heirloom Tomatoes')).click();
  await expect(page).toHaveURL(/\/listing\/l1$/);
  await expect(page.getByRole('heading', { name: 'Heirloom Tomatoes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make Offer' })).toBeVisible();
});

test('bottom nav moves between tabs', async ({ page }) => {
  await page.goto('/marketplace');
  await page.getByRole('button', { name: 'Offers' }).click();
  await expect(page.getByRole('heading', { name: 'My Offers' })).toBeVisible();
  await page.getByRole('button', { name: 'Messages' }).click();
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByText('Test Grower')).toBeVisible();
});

test('filters listing cards with search', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.locator('.listing-card')).toHaveCount(2);
  await page.getByPlaceholder('Search produce…').fill('eggs');
  await expect(page.locator('.listing-card')).toHaveCount(1);
  await expect(page.locator(card('Fresh Eggs'))).toBeVisible();
  await expect(page.locator(card('Heirloom Tomatoes'))).toHaveCount(0);
});
