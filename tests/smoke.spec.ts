import { test, expect } from '@playwright/test';

// Unauthenticated: no token seeded, so the app should land on the auth screen.
test('shows the login screen when unauthenticated', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Share Crops' })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
});

test('rejects a malformed email before hitting the network', async ({ page }) => {
  await page.goto('/login');
  // "foo@bar" passes the browser's native type=email check (no TLD required)
  // but fails the app's validateEmail (which requires a dot), so the form
  // submits and the app's own validation message appears.
  await page.locator('input[type="email"]').fill('foo@bar');
  await page.locator('input[type="password"]').fill('whatever');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
});

test('toggling to sign up reveals the name field', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByPlaceholder('Your name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});
