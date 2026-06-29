import type { Page, Route } from '@playwright/test';
import { signInAsVerifiedUser } from './firebase-emulator';

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

// Member previews for the profile's "My Communities" avatars.
export const MEMBERS = [
  { id: 'me', name: 'Test Grower', profilePhotoUrl: null },
  { id: 's1', name: 'Maya', profilePhotoUrl: null },
  { id: 's2', name: 'Daniel', profilePhotoUrl: null },
  { id: 's3', name: 'Elena', profilePhotoUrl: null },
  { id: 's4', name: 'Marcus', profilePhotoUrl: null },
  { id: 's5', name: 'Priya', profilePhotoUrl: null },
  { id: 's7', name: 'June', profilePhotoUrl: null },
];

const S1 = seller('s1', 'Maya', 4.8, 42);
const S2 = seller('s2', 'Daniel', 4.4, 27);
const S3 = seller('s3', 'Elena', 4.9, 63);
const S4 = seller('s4', 'Marcus', 4.2, 15);
const S5 = seller('s5', 'Priya', 5.0, 31);
const S6 = seller('s6', 'Tom', 3.9, 9);
const S7 = seller('s7', 'June', 4.7, 54);
const SME = seller(ME.id, ME.name, ME.rating, ME.ratingCount); // the signed-in (admin) user

// A listing factory keeps the deterministic fields terse; only the interesting
// bits (title, seller, status, dates) are spelled out per item.
let order = 0;
const make = (
  id: string,
  sellerObj: ReturnType<typeof seller>,
  title: string,
  description: string,
  quantity: string,
  extra: Partial<{ lookingFor: string; status: 'active' | 'completed' }> = {}
) => {
  order += 1;
  const day = String(20 - order).padStart(2, '0'); // newer first
  return {
    id, sellerId: sellerObj.id, title, description, quantity,
    photos: [`https://example.com/${id}.jpg`],
    lookingFor: extra.lookingFor,
    communityId: 'c1', zipCode: '98112', status: extra.status ?? 'active',
    createdAt: `2026-06-${day}T00:00:00Z`, expiresAt: '2026-07-05T00:00:00Z', seller: sellerObj,
  };
};

export const LISTINGS = [
  make('l1', S1, 'Heirloom Tomatoes', 'Sweet, low-acid, picked this morning.', '6 lbs', { lookingFor: 'Fresh basil' }),
  make('l2', S2, 'Fresh Eggs', 'A dozen mixed brown & blue, pasture-raised.', '1 dozen', { lookingFor: 'Sourdough' }),
  make('l3', S3, 'Genovese Basil', 'Fragrant bunches, perfect for pesto.', '4 bunches', { lookingFor: 'Tomatoes' }),
  make('l4', S4, 'Rainbow Chard', 'Crisp rainbow stems, cut to order.', '3 bunches'),
  make('l5', S5, 'Meyer Lemons', 'Thin-skinned and floral, off our backyard tree.', '20 ct', { lookingFor: 'Honey' }),
  make('l6', S6, 'Sourdough Loaf', 'Naturally leavened, 24-hour ferment.', '2 loaves'),
  make('l7', S1, 'Sugar Snap Peas', 'Snappy and sweet, great raw.', '2 lbs'),
  make('l8', S2, 'Zucchini Glut', 'Garden is overflowing — take some please!', '5 lbs', { lookingFor: 'Anything' }),
  make('l9', S3, 'Strawberries', 'Everbearing, small but intensely sweet.', '3 pints'),
  make('l10', S7, 'Raw Wildflower Honey', 'Unfiltered, from hives two blocks over.', '3 jars', { lookingFor: 'Lemons' }),
  make('l11', S4, 'Fingerling Potatoes', 'Buttery and waxy, freshly dug.', '8 lbs', { status: 'completed' }),
  make('l12', S5, 'Padrón Peppers', 'Blistering-good in a hot pan. One in ten is spicy!', '1 lb'),
  // The signed-in admin user's own listings (shown under "My Listings").
  make('l13', SME, 'Carolina Reaper Starts', 'Seedlings for the brave — six to a tray.', '6 starts', { lookingFor: 'Compost' }),
  make('l14', SME, 'Concord Grapes', 'Old-vine, intensely jammy. Great for jelly.', '4 lbs'),
  make('l15', SME, 'Lemon Cucumbers', 'Round, mild, and never bitter.', '3 lbs', { lookingFor: 'Dill' }),
  make('l16', SME, 'Dahlia Bouquet', 'Cut-fresh dinnerplate dahlias, mixed colors.', '2 bunches', { status: 'completed' }),
];

export const TRENDING = [
  { listing: LISTINGS[0], offerCount: 7 },
  { listing: LISTINGS[2], offerCount: 5 },
  { listing: LISTINGS[8], offerCount: 4 },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Tiny PNG returned by mocked GET /images/:key (stable URL uploads). */
const MOCK_IMAGE_BODY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function stableImageUrl(route: Route, key: string): string {
  const url = new URL(route.request().url());
  const prefix = url.pathname.split('/upload')[0] || url.pathname.replace(/\/images\/.*$/, '');
  return `${url.origin}${prefix}/images/${key}`;
}

// Dispatches a mocked backend response based on the path suffix after the
// API prefix. Used for both the primary and fallback hosts.
async function dispatch(route: Route) {
  const url = new URL(route.request().url());
  const marker = '/make-server-dd877831';
  const markerIdx = url.pathname.indexOf(marker);
  const path = markerIdx >= 0 ? url.pathname.slice(markerIdx + marker.length) : '';

  if (path === '/auth/me') return json(route, { user: ME });
  if (path === '/communities/mine') return json(route, { communities: [COMMUNITY], activeCommunityId: COMMUNITY.id });
  if (path.startsWith('/communities/search')) return json(route, { communities: [COMMUNITY] });
  if (path.includes('/members/preview')) return json(route, { members: MEMBERS });
  if (path.startsWith('/trending')) return json(route, { items: TRENDING });
  if (path.startsWith('/offers/my')) return json(route, { offers: [] });
  if (path.startsWith('/chat/threads')) return json(route, { threads: [] });
  if (path === '/upload' && route.request().method() === 'POST') {
    const key = `mock-${Date.now()}.png`;
    return json(route, { success: true, url: stableImageUrl(route, key), path: key });
  }
  if (path.startsWith('/images/') && route.request().method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_IMAGE_BODY });
  }
  if (path.startsWith('/listings/user/')) {
    const uid = path.split('/listings/user/')[1];
    return json(route, { listings: LISTINGS.filter((l) => l.sellerId === uid) });
  }
  if (/^\/listings\/[^/]+$/.test(path) && route.request().method() === 'GET') {
    return json(route, { listing: LISTINGS[0] });
  }
  if (path === '/listings/draft-description' && route.request().method() === 'POST') {
    const body = route.request().postDataJSON() as { title?: string; notes?: string };
    const title = body?.title ?? '';
    return json(route, {
      description: `Fresh ${title.toLowerCase()} from our garden, picked this morning.`,
      usage: { inputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 20 },
    });
  }
  if (path.startsWith('/listings') && route.request().method() === 'GET') {
    return json(route, { listings: LISTINGS });
  }
  if (path.startsWith('/listings') && route.request().method() === 'POST') {
    return json(route, { listing: LISTINGS[0] });
  }
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
  await page.route('**/api/make-server-dd877831/**', async (route) => {
    // Same pattern matches fallback.test — defer to that handler.
    if (route.request().url().includes('fallback.test')) return route.fallback();
    if (opts.primaryFails) return json(route, { error: 'primary down' }, 500);
    return dispatch(route);
  });
}

/**
 * Mock the API and sign in via Firebase Auth Emulator (replaces legacy seedAuth).
 * Returns the emulator email used for this session.
 */
export async function setupAuthenticatedSession(
  page: Page,
  opts: { primaryFails?: boolean } = {},
): Promise<string> {
  await mockBackend(page, opts);
  return signInAsVerifiedUser(page);
}
