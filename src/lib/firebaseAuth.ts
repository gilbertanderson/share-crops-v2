import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
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

/** Sign in with Google via popup. Google accounts are email-verified, so they
 *  pass the backend's email_verified gate immediately. Requires the Google
 *  provider enabled + the app's domain in Authorized Domains (localhost is). */
export function signInWithGoogle(): Promise<User> {
  return signInWithPopup(auth, googleProvider).then((r) => r.user);
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
