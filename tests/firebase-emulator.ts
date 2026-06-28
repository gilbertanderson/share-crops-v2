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
