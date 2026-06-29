import { ApiError } from '@/lib/api';
import { PRIMARY_LOGIN_URL, resolveApiBases } from '@/lib/appDomains';

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === 'TypeError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  );
}

/** User-facing copy when Firebase sign-in succeeded but /auth/me bootstrap failed. */
export function profileLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return `Signed in with Google, but the API rejected your session (401 on ${window.location.hostname}). Confirm Firebase Authorized domains include this host and that Vercel FIREBASE_PROJECT_ID is share-crops-app.`;
    }
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      return `The API is temporarily unavailable (${err.status}). Try again in a minute, or check that Vercel server env vars (SUPABASE_*, ADMIN_EMAIL, CORS_ORIGINS) are set and the deployment succeeded.`;
    }
    return err.message;
  }

  if (isNetworkError(err)) {
    const bases = resolveApiBases();
    return `Could not reach the API (${bases.join(' → ')}). The server may be missing env vars on Vercel (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, CORS_ORIGINS) or the deployment failed. Try again, or sign in at ${PRIMARY_LOGIN_URL}.`;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'Could not load your profile. Please try again.';
}
