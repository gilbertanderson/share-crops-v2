import type { Page, Route } from '@playwright/test';

// Deterministic fixture data returned by the mocked backend.
export const ME = {
  id: 'me', email: 'you@test.dev', name: 'Test Grower', bio: 'Backyard gardener.',
  rating: 4.6, ratingCount: 18, role: 'general', createdAt: '2026-01-01T00:00:00Z',
};

export const COMMUNITY = {
  id: 'c1', name: 'Eastside Growers', zipCode: '98112', createdBy: 'me',
  memberCount: 184, createdAt: '2026-01-01T00:00:00Z',
};

const seller = (id: string, name: string, rating: number, count: number) => ({
  id, name, rating, ratingCount: count, role: 'general', email: '', createdAt: '',
});

export const LISTINGS = [
  {
    id: 'l1', sellerId: 's1', title: 'Heirloom Tomatoes', description: 'Sweet, low-acid, picked this morning.',
    quantity: '6 lbs', photos: ['https://example.com/tomato.jpg'], lookingFor: 'Fresh basil',
    communityId: 'c1', zipCode: '98112', status: 'active',
    createdAt: '2026-06-10T00:00:00Z', expiresAt: '2026-06-30T00:00:00Z', seller: seller('s1', 'Maya', 4.8, 42),
  },
  {
    id: 'l2', sellerId: 's2', title: 'Fresh Eggs', description: 'A dozen mixed brown & blue eggs.',
    quantity: '1 dozen', photos: ['https://example.com/eggs.jpg'],
    communityId: 'c1', zipCode: '98112', status: 'active',
    createdAt: '2026-06-09T00:00:00Z', expiresAt: '2026-06-29T00:00:00Z', seller: seller('s2', 'Daniel', 4.4, 27),
  },
];

export const TRENDING = [{ listing: LISTINGS[0], offerCount: 7 }];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// Dispatches a mocked backend response based on the path suffix after the
// API prefix. Used for both the primary and fallback hosts.
async function dispatch(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname.split('/make-server-dd877831')[1] || '';

  if (path === '/auth/me') return json(route, { user: ME });
  if (path === '/communities/mine') return json(route, { communities: [COMMUNITY], activeCommunityId: COMMUNITY.id });
  if (path.startsWith('/communities/search')) return json(route, { communities: [COMMUNITY] });
  if (path.startsWith('/trending')) return json(route, { items: TRENDING });
  if (path.startsWith('/offers/my')) return json(route, { offers: [] });
  if (path.startsWith('/chat/threads')) return json(route, { threads: [] });
  if (/^\/listings\/[^/]+$/.test(path)) return json(route, { listing: LISTINGS[0] });
  if (path.startsWith('/listings')) return json(route, { listings: LISTINGS });
  if (path.startsWith('/profile/')) return json(route, { profile: ME });
  return json(route, {});
}

/**
 * Install backend mocks. By default the primary (Supabase) host serves data.
 * With { primaryFails: true } the primary returns 500 so the app must fail
 * over to the Vercel fallback host (which always serves data here).
 */
export async function mockBackend(page: Page, opts: { primaryFails?: boolean } = {}) {
  await page.route('**/functions/v1/make-server-dd877831/**', async (route) => {
    if (opts.primaryFails) return json(route, { error: 'primary down' }, 500);
    return dispatch(route);
  });
  await page.route('**/fallback.test/api/make-server-dd877831/**', dispatch);
}

/** Seed an auth token so the app boots into the authenticated shell. */
export async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sharecrops_token', 'test-token');
  });
}
