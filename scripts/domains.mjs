/** Canonical production hostnames — imported by configure-production.mjs. */
export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const NETLIFY_APP_ORIGIN = 'https://sharecropsmarketplace.netlify.app';
export const FIREBASE_AUTH_DOMAIN = 'share-crops-app.firebaseapp.com';
export const API_PATH = '/api/make-server-dd877831';

export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const FALLBACK_API_BASE = `${FALLBACK_APP_ORIGIN}${API_PATH}`;

export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
export const NETLIFY_HOSTNAME = 'sharecropsmarketplace.netlify.app';

/** Comma-separated origins for CORS_ORIGINS (server + Vercel env). */
export const PRODUCTION_CORS_ORIGINS = [
  PRIMARY_APP_ORIGIN,
  FALLBACK_APP_ORIGIN,
  NETLIFY_APP_ORIGIN,
  'http://localhost:5173',
  'http://localhost:4321',
].join(',');
