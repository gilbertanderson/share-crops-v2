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
 */
export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_APP_ORIGIN = 'https://sharecropsmarketplace.netlify.app';
export const FIREBASE_AUTH_DOMAIN = 'share-crops-app.firebaseapp.com';
export const API_PATH = '/api/make-server-dd877831';

export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const VERCEL_FALLBACK_API_BASE = `${VERCEL_FALLBACK_APP_ORIGIN}${API_PATH}`;

export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const VERCEL_FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
export const NETLIFY_FALLBACK_HOSTNAME = 'sharecropsmarketplace.netlify.app';

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
  'http://localhost:5173',
  'http://localhost:4321',
].join(',');
