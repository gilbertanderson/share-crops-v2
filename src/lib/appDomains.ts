/**
 * Canonical production URLs (keep in sync with scripts/domains.mjs).
 *
 * 1. PRIMARY — share-crops-v2.vercel.app (main; Firebase auth works here)
 * 2. VERCEL_FALLBACK — share-crops-marketplace.vercel.app (backup Vercel)
 * 3. NETLIFY_FALLBACK — sharecropsmarketplace.netlify.app (static hosting backup)
 */
export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_HOSTNAME = 'sharecropsmarketplace.netlify.app';

export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_APP_ORIGIN = 'https://sharecropsmarketplace.netlify.app';

/** Main sign-in URL — share Firebase auth with users. */
export const PRIMARY_LOGIN_URL = `${PRIMARY_APP_ORIGIN}/login`;

export const API_PATH = '/api/make-server-dd877831';
export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const VERCEL_FALLBACK_API_BASE = `${VERCEL_FALLBACK_APP_ORIGIN}${API_PATH}`;
export const SAME_ORIGIN_API_BASE = API_PATH;

/** @deprecated Use VERCEL_FALLBACK_* */
export const FALLBACK_HOSTNAME = VERCEL_FALLBACK_HOSTNAME;
export const FALLBACK_APP_ORIGIN = VERCEL_FALLBACK_APP_ORIGIN;
export const FALLBACK_API_BASE = VERCEL_FALLBACK_API_BASE;
/** @deprecated Use NETLIFY_FALLBACK_* */
export const NETLIFY_HOSTNAME = NETLIFY_FALLBACK_HOSTNAME;
export const NETLIFY_APP_ORIGIN = NETLIFY_FALLBACK_APP_ORIGIN;

export const AUTHORIZED_APP_HOSTNAMES = [
  PRIMARY_HOSTNAME,
  VERCEL_FALLBACK_HOSTNAME,
  NETLIFY_FALLBACK_HOSTNAME,
  'localhost',
] as const;

/** True when this host serves the Vercel /api function on the same origin. */
export function isVercelAppHost(hostname = window.location.hostname): boolean {
  return (
    hostname === PRIMARY_HOSTNAME ||
    hostname === VERCEL_FALLBACK_HOSTNAME ||
    hostname.endsWith('.vercel.app')
  );
}

export function isNetlifyFallbackHost(hostname = window.location.hostname): boolean {
  return hostname === NETLIFY_FALLBACK_HOSTNAME || hostname.endsWith('.netlify.app');
}

/**
 * API bases to try, in order.
 * - PRIMARY (v2): same-origin /api, then marketplace Vercel API.
 * - VERCEL_FALLBACK (marketplace): same-origin /api only.
 * - NETLIFY_FALLBACK: remote v2 API, then marketplace API (no local /api).
 */
export function resolveApiBases(envFallback = import.meta.env.VITE_FALLBACK_API_URL): string[] {
  const vercelFallbackApi = (envFallback || '').replace(/\/$/, '') || VERCEL_FALLBACK_API_BASE;
  const hostname = window.location.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const bases = [SAME_ORIGIN_API_BASE];
    if (vercelFallbackApi && !vercelFallbackApi.endsWith(SAME_ORIGIN_API_BASE)) {
      bases.push(vercelFallbackApi);
    }
    return bases;
  }

  if (isNetlifyFallbackHost(hostname)) {
    const remote = [PRIMARY_API_BASE];
    if (vercelFallbackApi && vercelFallbackApi !== PRIMARY_API_BASE) {
      remote.push(vercelFallbackApi);
    }
    return remote;
  }

  if (!isVercelAppHost(hostname)) {
    return [PRIMARY_API_BASE, vercelFallbackApi].filter(
      (base, i, arr) => base && arr.indexOf(base) === i,
    );
  }

  const bases = [SAME_ORIGIN_API_BASE];
  if (hostname === PRIMARY_HOSTNAME && vercelFallbackApi && !vercelFallbackApi.endsWith(SAME_ORIGIN_API_BASE)) {
    bases.push(vercelFallbackApi);
  }
  return bases;
}
