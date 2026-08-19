/**
 * Canonical production URLs (keep in sync with scripts/domains.mjs).
 *
 * 1. PRIMARY — share-crops-v2.vercel.app (main; Firebase auth works here)
 * 2. VERCEL_FALLBACK — share-crops-marketplace.vercel.app (backup Vercel)
 * 3. SUPABASE_EDGE — Supabase Edge Function (tertiary failover when Vercel /api is down)
 * 4. NETLIFY_FALLBACK — sharecropsmarketplace.netlify.app (static hosting backup)
 * 5. FIREBASE_HOSTING — share-crops-app.web.app (static hosting on Firebase CDN)
 */
export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_HOSTNAME = 'sharecropsmarketplace.netlify.app';
export const FIREBASE_HOSTING_HOSTNAME = 'share-crops-app.web.app';
export const FIREBASE_HOSTING_ALT_HOSTNAME = 'share-crops-app.firebaseapp.com';

export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_APP_ORIGIN = 'https://sharecropsmarketplace.netlify.app';
export const FIREBASE_HOSTING_APP_ORIGIN = 'https://share-crops-app.web.app';
export const FIREBASE_HOSTING_ALT_ORIGIN = 'https://share-crops-app.firebaseapp.com';

/** Main sign-in URL — share Firebase auth with users. */
export const PRIMARY_LOGIN_URL = `${PRIMARY_APP_ORIGIN}/login`;

export const API_PATH = '/api/make-server-dd877831';
export const SUPABASE_PROJECT_REF = 'xwjvtpzpufhuybylnwzx';
export const SUPABASE_EDGE_FUNCTION = 'make-server-dd877831';
/**
 * Supabase Edge Function API base. Supabase maps
 * `/functions/v1/<fn>/auth/me` → Hono path `/<fn>/auth/me`, so this must NOT
 * repeat the function slug (a double prefix 404s — see Supabase edge logs).
 */
export const SUPABASE_EDGE_API_BASE =
  `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/${SUPABASE_EDGE_FUNCTION}`;

export function isSupabaseEdgeBase(base: string): boolean {
  return base.includes('.supabase.co/functions/v1/');
}

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
  FIREBASE_HOSTING_HOSTNAME,
  FIREBASE_HOSTING_ALT_HOSTNAME,
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

function isCanonicalVercelAppHost(hostname: string): boolean {
  return hostname === PRIMARY_HOSTNAME || hostname === VERCEL_FALLBACK_HOSTNAME;
}

export function isNetlifyFallbackHost(hostname = window.location.hostname): boolean {
  return hostname === NETLIFY_FALLBACK_HOSTNAME || hostname.endsWith('.netlify.app');
}

export function isFirebaseHostingHost(hostname = window.location.hostname): boolean {
  return (
    hostname === FIREBASE_HOSTING_HOSTNAME ||
    hostname === FIREBASE_HOSTING_ALT_HOSTNAME ||
    hostname.endsWith('.web.app') ||
    hostname.endsWith('.firebaseapp.com')
  );
}

function uniqueBases(bases: string[]): string[] {
  return bases.filter((base, i, arr) => base && arr.indexOf(base) === i);
}

function withSupabaseEdgeFailover(bases: string[]): string[] {
  return uniqueBases([...bases, SUPABASE_EDGE_API_BASE]);
}

/**
 * API bases to try, in order.
 * - PRIMARY (v2): same-origin /api, marketplace Vercel API, then Supabase Edge.
 * - VERCEL_FALLBACK (marketplace): same-origin /api, then Supabase Edge.
 * - VERCEL PREVIEWS: same-origin only, so broken preview APIs fail visibly
 *   instead of writing through production fallbacks.
 * - NETLIFY_FALLBACK / FIREBASE_HOSTING: remote v2 API, marketplace API, then Supabase Edge.
 */
export function resolveApiBasesForHost(
  hostname: string,
  envFallback = '',
): string[] {
  const vercelFallbackApi = (envFallback || '').replace(/\/$/, '') || VERCEL_FALLBACK_API_BASE;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const bases = [SAME_ORIGIN_API_BASE];
    if (vercelFallbackApi && vercelFallbackApi !== SAME_ORIGIN_API_BASE) {
      bases.push(vercelFallbackApi);
    }
    return withSupabaseEdgeFailover(bases);
  }

  if (isNetlifyFallbackHost(hostname) || isFirebaseHostingHost(hostname)) {
    const remote = [PRIMARY_API_BASE];
    if (vercelFallbackApi && vercelFallbackApi !== PRIMARY_API_BASE) {
      remote.push(vercelFallbackApi);
    }
    return withSupabaseEdgeFailover(remote);
  }

  if (!isVercelAppHost(hostname)) {
    return withSupabaseEdgeFailover(uniqueBases([PRIMARY_API_BASE, vercelFallbackApi]));
  }

  const bases = [SAME_ORIGIN_API_BASE];
  if (!isCanonicalVercelAppHost(hostname)) {
    return bases;
  }

  const useMarketplaceFallback =
    hostname === PRIMARY_HOSTNAME &&
    vercelFallbackApi &&
    vercelFallbackApi !== SAME_ORIGIN_API_BASE;
  if (useMarketplaceFallback) {
    bases.push(vercelFallbackApi);
  }
  return withSupabaseEdgeFailover(bases);
}

export function resolveApiBases(envFallback = import.meta.env.VITE_FALLBACK_API_URL): string[] {
  return resolveApiBasesForHost(window.location.hostname, envFallback || '');
}
