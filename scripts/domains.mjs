/**
 * Canonical production URLs — keep in sync with src/lib/appDomains.ts.
 *
 * 1. PRIMARY (main)     — share-crops-v2.vercel.app
 *    Vercel SPA + /api. Use this URL for sign-in; Firebase auth is configured here.
 *
 * 2. VERCEL_FALLBACK    — share-crops-marketplace.vercel.app
 *    Backup Vercel deployment (API + SPA) when primary is down.
 *
 * 3. NETLIFY_FALLBACK   — sharecropsmarketplace.netlify.app
 *    Static hosting fallback only (no /api). SPA calls Vercel APIs remotely.
 *
 * 4. FIREBASE_HOSTING   — share-crops-app.web.app (+ .firebaseapp.com)
 *    Static hosting on Firebase CDN (no /api). SPA calls Vercel APIs remotely.
 */
export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_APP_ORIGIN = 'https://sharecropsmarketplace.netlify.app';
export const FIREBASE_HOSTING_APP_ORIGIN = 'https://share-crops-app.web.app';
export const FIREBASE_HOSTING_ALT_ORIGIN = 'https://share-crops-app.firebaseapp.com';
export const FIREBASE_AUTH_DOMAIN = 'share-crops-app.firebaseapp.com';
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

export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const VERCEL_FALLBACK_API_BASE = `${VERCEL_FALLBACK_APP_ORIGIN}${API_PATH}`;

export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_HOSTNAME = 'sharecropsmarketplace.netlify.app';
export const FIREBASE_HOSTING_HOSTNAME = 'share-crops-app.web.app';
export const FIREBASE_HOSTING_ALT_HOSTNAME = 'share-crops-app.firebaseapp.com';

/** @deprecated Use VERCEL_FALLBACK_* — kept for older imports */
export const FALLBACK_APP_ORIGIN = VERCEL_FALLBACK_APP_ORIGIN;
export const FALLBACK_HOSTNAME = VERCEL_FALLBACK_HOSTNAME;
export const FALLBACK_API_BASE = VERCEL_FALLBACK_API_BASE;

/** @deprecated Use NETLIFY_FALLBACK_* */
export const NETLIFY_HOSTNAME = NETLIFY_FALLBACK_HOSTNAME;
export const NETLIFY_APP_ORIGIN = NETLIFY_FALLBACK_APP_ORIGIN;

/** Comma-separated origins for CORS_ORIGINS (server + Vercel env). */
export const PRODUCTION_CORS_ORIGINS = [
  PRIMARY_APP_ORIGIN,
  VERCEL_FALLBACK_APP_ORIGIN,
  NETLIFY_FALLBACK_APP_ORIGIN,
  FIREBASE_HOSTING_APP_ORIGIN,
  FIREBASE_HOSTING_ALT_ORIGIN,
  'http://localhost:5173',
  'http://localhost:4321',
].join(',');

export const SAME_ORIGIN_API_BASE = API_PATH;

function uniqueBases(bases) {
  return bases.filter((base, i, arr) => base && arr.indexOf(base) === i);
}

function withSupabaseEdgeFailover(bases) {
  return uniqueBases([...bases, SUPABASE_EDGE_API_BASE]);
}

export function isVercelAppHost(hostname) {
  return (
    hostname === PRIMARY_HOSTNAME ||
    hostname === VERCEL_FALLBACK_HOSTNAME ||
    hostname.endsWith('.vercel.app')
  );
}

export function isNetlifyFallbackHost(hostname) {
  return hostname === NETLIFY_FALLBACK_HOSTNAME || hostname.endsWith('.netlify.app');
}

export function isFirebaseHostingHost(hostname) {
  return (
    hostname === FIREBASE_HOSTING_HOSTNAME ||
    hostname === FIREBASE_HOSTING_ALT_HOSTNAME ||
    hostname.endsWith('.web.app') ||
    hostname.endsWith('.firebaseapp.com')
  );
}

/**
 * API bases to try, in order.
 * - PRIMARY (v2): same-origin /api, marketplace Vercel API, then Supabase Edge.
 * - VERCEL_FALLBACK (marketplace): same-origin /api, then Supabase Edge.
 * - NETLIFY_FALLBACK / FIREBASE_HOSTING: remote v2 API, marketplace API, then Supabase Edge.
 */
export function resolveApiBasesForHost(hostname, envFallback = '') {
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
  if (hostname === PRIMARY_HOSTNAME && vercelFallbackApi && vercelFallbackApi !== SAME_ORIGIN_API_BASE) {
    bases.push(vercelFallbackApi);
  }
  return withSupabaseEdgeFailover(bases);
}
