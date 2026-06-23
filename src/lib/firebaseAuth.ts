import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

const googleProvider = new GoogleAuthProvider();

/** Create a new account with email + password. Returns the signed-in user. */
export function signUpWithEmail(email: string, password: string): Promise<User> {
  return createUserWithEmailAndPassword(auth, email, password).then((c) => c.user);
}

/** Sign in an existing user with email + password. */
export function signInWithEmail(email: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(auth, email, password).then((c) => c.user);
}

/** Sign in with Google via popup. Requires Google provider enabled + the app's
 *  domain in Authorized Domains (localhost is allowed by default). */
export function signInWithGoogle(): Promise<User> {
  return signInWithPopup(auth, googleProvider).then((r) => r.user);
}

/** Subscribe to auth state. Fires with the user (or null) on sign-in/out and on
 *  initial load once Firebase resolves the persisted session. Returns unsubscribe. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/** The current ID token (JWT) for authenticating calls to a backend, or null. */
export function getIdToken(): Promise<string | null> {
  return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

/** Sign the current user out. */
export function logout(): Promise<void> {
  return signOut(auth);
}
