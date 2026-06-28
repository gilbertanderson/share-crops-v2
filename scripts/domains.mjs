/** Canonical production hostnames — imported by configure-production.mjs. */
export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';
export const FIREBASE_AUTH_DOMAIN = 'share-crops-app.firebaseapp.com';
export const API_PATH = '/api/make-server-dd877831';

export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const FALLBACK_API_BASE = `${FALLBACK_APP_ORIGIN}${API_PATH}`;

export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';
