import { expect, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const EMULATOR_HOST = '127.0.0.1:9099';

/** Shared password for emulator test accounts (meets client signup policy). */
export const TEST_PASSWORD = 'Test123456!';

function authAdmin() {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR_HOST;
  if (!getApps().length) {
    initializeApp({ projectId: 'demo-share-crops' });
  }
  return getAuth();
}

/** Create or refresh an email/password user with emailVerified=true in the Auth Emulator. */
export async function ensureVerifiedEmulatorUser(email: string, password: string): Promise<void> {
  const auth = authAdmin();
  try {
    await auth.createUser({ email, password, emailVerified: true });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/email-already-exists') throw err;
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, emailVerified: true });
  }
}

/** Unique throwaway email for parallel-safe emulator users. */
export function testEmail(label: string): string {
  return `${label}+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/** Sign into the SPA with a verified emulator account (lands in marketplace when backend is mocked). */
export async function signInViaUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
}

/** Firebase Auth Emulator mock OAuth UI (popup or full-page redirect). */
async function completeEmulatorGoogleOAuth(oauthPage: Page): Promise<string> {
  await oauthPage.waitForLoadState('domcontentloaded');

  const addNewAccount = oauthPage.getByRole('button', { name: /add new account/i });
  if (await addNewAccount.isVisible().catch(() => false)) {
    await addNewAccount.click();
    await oauthPage.waitForLoadState('domcontentloaded');
    await oauthPage.getByRole('button', { name: /auto-generate/i }).click();
  } else {
    const existing = oauthPage.getByRole('listitem').first();
    if (await existing.isVisible().catch(() => false)) {
      await existing.click();
    }
  }

  const email = await oauthPage.getByRole('textbox').first().inputValue();
  await oauthPage.getByRole('button', { name: /^sign in$/i }).click();
  return email;
}

/**
 * Emulator-only Google credential when popup/redirect UI is unavailable (e.g. CI).
 * @see https://firebase.google.com/docs/emulator-suite/connect_auth#non-interactive
 */
async function signInWithGoogleCredentialInBrowser(page: Page, email: string): Promise<void> {
  await page.evaluate(async (googleEmail) => {
    const { emulatorGoogleSignIn } = await import('/src/lib/emulatorGoogleSignIn.ts');
    await emulatorGoogleSignIn(googleEmail);
  }, email);
}

/**
 * Complete Google sign-in via the Firebase Auth Emulator (signInWithPopup or redirect).
 * Falls back to the emulator's non-interactive Google credential when popups are blocked.
 *
 * @see https://gist.github.com/sureshjoshi/023fb5382d2c80d73d1ce5b15e74be6f
 */
export async function signInWithGoogleViaEmulator(
  page: Page,
  email: string = testEmail('google'),
): Promise<string> {
  await page.goto('/login');

  const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  const emulatorNavPromise = page
    .waitForURL(/9099\/emulator\/auth\/handler/, { timeout: 5_000 })
    .then(() => 'redirect' as const)
    .catch(() => null);

  await page.getByRole('button', { name: 'Continue with Google' }).click();

  const [popup, redirected] = await Promise.all([popupPromise, emulatorNavPromise]);

  if (popup) {
    await popup.waitForLoadState('domcontentloaded');
    const chosenEmail = await completeEmulatorGoogleOAuth(popup);
    await popup.waitForEvent('close', { timeout: 15_000 }).catch(() => {});
    await expect(page).toHaveURL(/\/marketplace$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    return chosenEmail;
  }

  if (redirected) {
    const chosenEmail = await completeEmulatorGoogleOAuth(page);
    await expect(page).toHaveURL(/\/marketplace$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    return chosenEmail || email;
  }

  // Popup blocked in automated Chrome — same Google provider via emulator credential API.
  await page.goto('/login');
  await signInWithGoogleCredentialInBrowser(page, email);
  await expect(page).toHaveURL(/\/marketplace$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  return email;
}

/**
 * Create a verified emulator user, sign in through the login UI, and wait for
 * the authenticated marketplace shell (Firebase auth + mocked /auth/me).
 */
export async function signInAsVerifiedUser(
  page: Page,
  email: string = testEmail('e2e'),
  password: string = TEST_PASSWORD,
): Promise<string> {
  await ensureVerifiedEmulatorUser(email, password);
  await signInViaUi(page, email, password);
  await expect(page).toHaveURL(/\/marketplace$/, { timeout: 15_000 });
  return email;
}
