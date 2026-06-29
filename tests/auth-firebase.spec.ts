import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';
import { signInWithGoogleViaEmulator } from './firebase-emulator';

// Firebase auth flow. Unauthenticated users are routed to /login; signup is
// gated by the client password policy and, once that passes, lands on the
// "Check your email" verification screen (the backend rejects unverified-email
// tokens, so the app holds the user there until they confirm).
//
// Google sign-in uses signInWithPopup against the Auth Emulator's mock OAuth UI
// (not real accounts.google.com). Backend /auth/me is mocked so profile load
// succeeds without a live API.
//
// NOTE: the happy-path signup test creates a real Firebase user (with a unique
// throwaway address) and triggers a verification email — Firebase has no test
// double here. Each run uses a fresh email so reruns don't collide.

test.describe('Firebase auth', () => {
  test('redirects an unauthenticated visitor from the app root to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Share Crops' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
  });

  test('blocks signup with a password that fails the policy', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign up' }).click();

    await page.getByPlaceholder('Your name').fill('Test Grower');
    await page.locator('input[type="email"]').fill(`weakpw+${Date.now()}@example.com`);
    await page.locator('input[type="password"]').fill('weak'); // < 8 chars
    await page.getByRole('button', { name: 'Create Account' }).click();

    // First policy error surfaces; the verification screen is NOT reached.
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  });

  test('signup with a compliant password lands on the verification screen', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign up' }).click();

    const email = `verifyflow+${Date.now()}@example.com`;
    await page.getByPlaceholder('Your name').fill('Test Grower');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('Test123456!'); // meets all policy rules
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('button', { name: "I've verified my email" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
  });

  test('Google sign-in lands on marketplace', async ({ page }) => {
    test.setTimeout(60_000);
    await mockBackend(page);
    const email = await signInWithGoogleViaEmulator(page);
    expect(email).toMatch(/@/);
    await expect(page.locator('.auth-error')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  });

  test('shows Continue with Google on the login screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });
});
