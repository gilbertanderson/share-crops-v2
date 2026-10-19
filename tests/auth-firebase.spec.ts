import { test, expect, type Route } from '@playwright/test';
import { COMMUNITY, ME, mockBackend } from './fixtures';
import {
  markEmulatorUserEmailVerified,
  signInWithGoogleViaEmulator,
} from './firebase-emulator';

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

  test('after email verification, refreshes the ID token before profile load', async ({ page }) => {
    await page.route('**/make-server-dd877831/**', async (route) => {
      const url = new URL(route.request().url());
      const marker = '/make-server-dd877831';
      const markerIdx = url.pathname.indexOf(marker);
      const path = markerIdx >= 0 ? url.pathname.slice(markerIdx + marker.length) : '';

      if (path === '/auth/me') {
        const authHeader = route.request().headers().authorization;
        if (!hasVerifiedEmailClaim(authHeader)) {
          return json(route, { error: 'Unauthorized' }, 401);
        }
        return json(route, { user: ME });
      }
      if (path === '/communities/mine') {
        return json(route, { communities: [COMMUNITY], activeCommunityId: COMMUNITY.id });
      }
      if (path.startsWith('/listings')) {
        return json(route, { listings: [], nextCursor: null });
      }
      if (path.startsWith('/trending')) {
        return json(route, { items: [] });
      }
      return json(route, {});
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign up' }).click();

    const email = `verify-refresh+${Date.now()}@example.com`;
    await page.getByPlaceholder('Your name').fill('Verified Grower');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('Test123456!');
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await markEmulatorUserEmailVerified(email);
    await page.getByRole('button', { name: "I've verified my email" }).click();

    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    await expect(page.locator('.auth-error')).toHaveCount(0);
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

function hasVerifiedEmailClaim(authHeader?: string): boolean {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = token?.split('.')[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.email_verified === true;
  } catch {
    return false;
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
