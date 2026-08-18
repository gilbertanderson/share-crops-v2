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
    if (err.status === 404) {
      return `API route not found (404). The Vercel /api function may not be deployed — confirm the latest deploy succeeded and open ${window.location.origin}/api/make-server-dd877831/health in your browser (should return JSON, not HTML).`;
    }
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      return `The API is temporarily unavailable (${err.status}). The app tried the configured Vercel API endpoints. Try again in a minute, or check that Vercel server env vars (SUPABASE_*, ADMIN_EMAIL, CORS_ORIGINS) are set and the deployment succeeded.`;
    }
    return err.message;
  }

  if (isNetworkError(err)) {
    const bases = resolveApiBases();
    const healthUrl = `${window.location.origin}/api/make-server-dd877831/health`;
    return `Could not reach the API (${bases.join(' → ')}). Open ${healthUrl} in a new tab — it should return JSON, not HTML. If it fails, confirm the latest Vercel deploy succeeded and server env vars are set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, CORS_ORIGINS). Try again, or sign in at ${PRIMARY_LOGIN_URL}.`;
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'Could not load your profile. Please try again.';
}
