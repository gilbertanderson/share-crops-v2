/** Canonical production hostnames (keep in sync with scripts/domains.mjs). */
export const PRIMARY_HOSTNAME = 'share-crops-v2.vercel.app';
export const FALLBACK_HOSTNAME = 'share-crops-marketplace.vercel.app';

export const PRIMARY_APP_ORIGIN = 'https://share-crops-v2.vercel.app';
export const FALLBACK_APP_ORIGIN = 'https://share-crops-marketplace.vercel.app';

export const API_PATH = '/api/make-server-dd877831';
export const PRIMARY_API_BASE = `${PRIMARY_APP_ORIGIN}${API_PATH}`;
export const FALLBACK_API_BASE = `${FALLBACK_APP_ORIGIN}${API_PATH}`;
export const SAME_ORIGIN_API_BASE = API_PATH;

/** True when this host serves the Vercel API at /api (not Netlify/static-only). */
export function isVercelAppHost(hostname = window.location.hostname): boolean {
  return (
    hostname === PRIMARY_HOSTNAME ||
    hostname === FALLBACK_HOSTNAME ||
    hostname.endsWith('.vercel.app')
  );
}

/**
 * API bases to try, in order.
 * - Vercel (v2 or marketplace): same-origin /api first; v2 also tries marketplace backup.
 * - Static hosts (Netlify, etc.): remote Vercel APIs only (primary then fallback).
 */
export function resolveApiBases(envFallback = import.meta.env.VITE_FALLBACK_API_URL): string[] {
  const configuredFallback = (envFallback || '').replace(/\/$/, '') || FALLBACK_API_BASE;
  const hostname = window.location.hostname;

  if (!isVercelAppHost(hostname)) {
    const remote = [PRIMARY_API_BASE];
    if (configuredFallback && configuredFallback !== PRIMARY_API_BASE) {
      remote.push(configuredFallback);
    }
    return remote;
  }

  const bases = [SAME_ORIGIN_API_BASE];
  if (hostname === PRIMARY_HOSTNAME && configuredFallback && !configuredFallback.endsWith(SAME_ORIGIN_API_BASE)) {
    bases.push(configuredFallback);
  }
  return bases;
}
