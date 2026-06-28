import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Map Firebase auth error codes to friendly, non-enumerating copy. */
export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as Error)?.message ?? '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists. Try logging in.';
    case 'auth/weak-password':
      return 'Please choose a stronger password (at least 6 characters).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Google sign-in was blocked by your browser. Allow pop-ups for this site, or try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/unauthorized-domain':
    case 'auth/unauthorized-continue-uri':
      return `Google sign-in is not allowed on ${window.location.hostname}. Add this domain under Firebase Console → Authentication → Settings → Authorized domains (use "localhost" for local dev, no https://).`;
    case 'auth/app-not-authorized':
      return 'This app is not authorized for Firebase Auth. Check the Firebase API key restrictions and Authorized domains for your project.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled. Turn it on in Firebase Console → Authentication → Sign-in method → Google.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Try email/password instead.';
    default:
      if (/forbidden|403/i.test(message)) {
        return `Google sign-in was forbidden on ${window.location.hostname}. Add this domain to Firebase Authorized domains and ensure Google is enabled as a sign-in provider.`;
      }
      return message || 'Something went wrong.';
  }
}

function isPopupFallbackError(code: string): boolean {
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/web-storage-unsupported'
  );
}

/** Returns a user-visible hint when Firebase env is misconfigured. The most
 *  common mistake is setting VITE_FIREBASE_AUTH_DOMAIN to the Vercel URL —
 *  it must stay as <project>.firebaseapp.com; the hosting hostname only goes
 *  in Firebase Console → Authorized domains. */
export function getFirebaseAuthConfigIssue(): string | null {
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (!authDomain || !projectId) {
    return 'Firebase is not fully configured for this build (missing VITE_FIREBASE_* env vars).';
  }
  if (!/\.(firebaseapp\.com|web\.app)$/.test(authDomain)) {
    return `Firebase authDomain is set to "${authDomain}" but must be ${projectId}.firebaseapp.com — not your site URL. Keep authDomain on firebaseapp.com and add "${window.location.hostname}" to Firebase Authorized domains.`;
  }
  return null;
}

/** Create an account, set the display name, and send a verification email. The
 *  backend rejects unverified-email tokens, so the caller should route the user
 *  to a "verify your email" state until they confirm. */
export async function signUpWithEmail(email: string, password: string, name?: string): Promise<User> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(user, { displayName: name });
  await sendEmailVerification(user);
  return user;
}

/** Sign in an existing user with email + password. */
export function signInWithEmail(email: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(auth, email, password).then((c) => c.user);
}

/** Complete a Google redirect sign-in after the page reloads. Call once on load;
 *  returns the signed-in user or null when there was no pending redirect. */
export async function consumeGoogleRedirectResult(): Promise<User | null> {
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
}

/** Sign in with Google via popup. Pop-ups stay on your current URL (no full-page
 *  redirect), which is more reliable when using a custom or Vercel domain — only
 *  the hostname must be in Firebase Authorized domains. Falls back to redirect
 *  only when the browser blocks the pop-up. */
export async function signInWithGoogle(): Promise<User> {
  try {
    return (await signInWithPopup(auth, googleProvider)).user;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (isPopupFallbackError(code)) {
      await signInWithRedirect(auth, googleProvider);
      return new Promise(() => {});
    }
    throw err;
  }
}

/** Subscribe to auth state. Fires with the user (or null) on sign-in/out and on
 *  initial load once Firebase resolves the persisted session. Returns unsubscribe. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/** The current ID token (JWT) for authenticating calls to a backend, or null.
 *  Firebase refreshes the underlying token automatically. */
export function getIdToken(): Promise<string | null> {
  return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

/** Email of the currently signed-in user, or null. */
export function currentUserEmail(): string | null {
  return auth.currentUser?.email ?? null;
}

/** (Re)send the verification email to the current user. No-op if signed out. */
export function sendVerificationEmail(): Promise<void> {
  return auth.currentUser ? sendEmailVerification(auth.currentUser) : Promise.resolve();
}

/** Reload the current user from the server so `emailVerified` reflects a
 *  just-clicked verification link. Returns the refreshed verified state. */
export async function reloadCurrentUser(): Promise<boolean> {
  if (!auth.currentUser) return false;
  await reload(auth.currentUser);
  return auth.currentUser.emailVerified;
}

/** Send a password-reset email. */
export function sendPasswordReset(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email);
}

/** Sign the current user out. */
export function logout(): Promise<void> {
  return signOut(auth);
}
