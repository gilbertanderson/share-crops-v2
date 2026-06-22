import { test, type Route } from '@playwright/test';
import { ME, COMMUNITY, LISTINGS, TRENDING, seedAuth } from './fixtures';

// Richer fixtures so the screenshots show populated screens (offers, threads,
// ratings) rather than empty states. Used only for visual capture.

const THREADS = [
  {
    id: 't1', participants: ['me', 's1'], listingId: 'l1', type: 'direct',
    lastMessage: 'Sounds great — I can swing by Saturday morning with the basil.',
    lastMessageAt: '2026-06-21T15:10:00Z', title: '',
  },
  {
    id: 't2', participants: ['me', 's2'], listingId: 'l2', type: 'direct',
    lastMessage: 'Do you still have the blue eggs?',
    lastMessageAt: '2026-06-20T09:30:00Z', title: '',
  },
];

const OFFERS = [
  {
    id: 'o1', listingId: 'l1', buyerId: 'me', sellerId: 's1', status: 'pending',
    offeredProduce: '2 bunches fresh basil + a jar of pesto',
    message: 'Would love to trade — picked the basil this morning.',
    createdAt: '2026-06-21T12:00:00Z',
    listing: LISTINGS[0], seller: LISTINGS[0].seller, buyer: { ...ME },
  },
  {
    id: 'o2', listingId: 'l2', buyerId: 'me', sellerId: 's2', status: 'accepted',
    offeredProduce: 'A dozen heirloom tomatoes',
    message: '', createdAt: '2026-06-19T12:00:00Z',
    listing: LISTINGS[1], seller: LISTINGS[1].seller, buyer: { ...ME },
  },
  {
    id: 'o3', listingId: 'l1', buyerId: 'me', sellerId: 's1', status: 'completed',
    offeredProduce: 'Sourdough loaf', message: '', createdAt: '2026-06-12T12:00:00Z',
    listing: LISTINGS[0], seller: LISTINGS[0].seller, buyer: { ...ME },
  },
];

const RATINGS = [
  { id: 'r1', raterUserId: 's1', ratedUserId: 'me', offerId: 'o3', rating: 5,
    comment: 'Lovely tomatoes and a super friendly trade. Would barter again!', createdAt: '2026-06-13T00:00:00Z' },
  { id: 'r2', raterUserId: 's2', ratedUserId: 'me', offerId: 'o2', rating: 4,
    comment: 'Smooth handoff, fresh produce.', createdAt: '2026-06-10T00:00:00Z' },
];

const PROFILES: Record<string, any> = {
  s1: LISTINGS[0].seller, s2: LISTINGS[1].seller, me: ME,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function richBackend(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname.split('/make-server-dd877831')[1] || '';

  if (path === '/auth/me') return json(route, { user: ME });
  if (path === '/communities/mine') return json(route, { communities: [COMMUNITY], activeCommunityId: COMMUNITY.id });
  if (path.startsWith('/communities/search')) return json(route, { communities: [COMMUNITY] });
  if (path.startsWith('/trending')) return json(route, { items: TRENDING });
  if (path.startsWith('/offers/my')) return json(route, { offers: OFFERS });
  if (path.startsWith('/chat/threads')) return json(route, { threads: THREADS });
  if (/^\/profile\/([^/]+)/.test(path)) {
    const uid = path.split('/profile/')[1].split('/')[0];
    if (path.includes('/ratings')) return json(route, { ratings: RATINGS });
    if (path.includes('/listings')) return json(route, { listings: LISTINGS });
    return json(route, { profile: PROFILES[uid] ?? ME });
  }
  if (/^\/listings\/[^/]+$/.test(path)) return json(route, { listing: LISTINGS[0] });
  if (path.startsWith('/listings')) return json(route, { listings: LISTINGS });
  return json(route, {});
}

const SHOTS: Array<{ name: string; path: string }> = [
  { name: 'marketplace', path: '/marketplace' },
  { name: 'listing-detail', path: '/listing/l1' },
  { name: 'offers', path: '/offers' },
  { name: 'messages', path: '/messages' },
  { name: 'profile', path: '/profile' },
];

for (const shot of SHOTS) {
  test(`screenshot ${shot.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await seedAuth(page);
    await page.route('**/functions/v1/make-server-dd877831/**', richBackend);
    await page.goto(shot.path);
    // Let queries settle and any tomato loader resolve.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `/tmp/v2-${shot.name}.png`, fullPage: true });
  });
}
