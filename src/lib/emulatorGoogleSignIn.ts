import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';

/**
 * Non-interactive Google sign-in for the Firebase Auth Emulator (e2e only).
 * Uses the emulator's mock IDP credential — not real Google OAuth.
 */
export async function emulatorGoogleSignIn(
  email: string,
  name = 'Google E2E User',
): Promise<string> {
  if (!import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('emulatorGoogleSignIn requires VITE_FIREBASE_AUTH_EMULATOR_HOST');
  }
  const idToken = JSON.stringify({
    sub: `google-e2e-${Date.now()}`,
    email,
    email_verified: true,
    name,
  });
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return email;
}
