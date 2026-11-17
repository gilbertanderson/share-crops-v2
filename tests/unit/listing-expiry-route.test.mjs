import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { build } from 'esbuild';

const ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));
const TEMP_DIR = join(tmpdir(), `share-crops-listing-expiry-${process.pid}`);
const BUNDLE = join(TEMP_DIR, 'server-app.mjs');

const testState = {
  listing: null,
  deletedListingIds: [],
};

globalThis.__listingExpiryRouteTest = testState;

const mockModules = new Map([
  ['./db.ts', `
    const state = globalThis.__listingExpiryRouteTest;
    const unexpected = async () => { throw new Error('Unexpected db call in listing expiry route test'); };
    export class DuplicateCommunityError extends Error {}
    export class DuplicateOfferError extends Error {}
    export class DuplicateRatingError extends Error {}
    export const getListing = async (id) => state.listing?.id === id ? state.listing : null;
    export const deleteListing = async (id) => { state.deletedListingIds.push(id); };
    export const getProfile = async () => null;
    export const addMembership = unexpected;
    export const clearCommunityMembers = unexpected;
    export const completeOffer = unexpected;
    export const createCommunity = unexpected;
    export const createThread = unexpected;
    export const deleteMessage = unexpected;
    export const deleteOffer = unexpected;
    export const deleteRating = unexpected;
    export const getActiveCommunityId = unexpected;
    export const getAdminUserIds = unexpected;
    export const getAllCommunities = unexpected;
    export const getCommunity = unexpected;
    export const getListingsByUser = unexpected;
    export const getMemberCommunities = unexpected;
    export const getMembershipCommunityIds = unexpected;
    export const getMessage = unexpected;
    export const getOffer = unexpected;
    export const getOffersByUser = unexpected;
    export const getRating = unexpected;
    export const getRatingsForUser = unexpected;
    export const getThread = unexpected;
    export const getThreadByDedupe = unexpected;
    export const getTrending = unexpected;
    export const insertListing = unexpected;
    export const insertMessage = unexpected;
    export const insertOffer = unexpected;
    export const insertRating = unexpected;
    export const isMember = unexpected;
    export const isThreadParticipant = unexpected;
    export const listCommunityMembers = unexpected;
    export const listMessages = unexpected;
    export const listThreadsForUser = unexpected;
    export const listingsNear = unexpected;
    export const queryListingsFeed = unexpected;
    export const removeMembership = unexpected;
    export const savePushToken = unexpected;
    export const searchCommunitiesByZip = unexpected;
    export const setActiveCommunityId = unexpected;
    export const setOfferStatus = unexpected;
    export const updateProfile = unexpected;
    export const upsertProfile = unexpected;
  `],
  ['./env.ts', `
    const values = {
      ADMIN_EMAIL: 'admin@example.test',
      APP_ID: 'dd877831',
      STORAGE_BUCKET_NAME: 'test-bucket',
      KV_TABLE_NAME: 'test-kv',
      CORS_ORIGINS: 'http://localhost:5173',
      SKIP_INIT: 'true',
    };
    export const getEnv = (key) => values[key] ?? process.env[key];
  `],
  ['./fcm.ts', 'export const sendPushToUser = async () => {};'],
  ['./firebaseAdmin.ts', `
    export const verifyFirebaseToken = async () => null;
    export const getFirebaseProjectId = () => 'demo-share-crops';
  `],
  ['./security.ts', `
    export const getSecurityHeaders = () => ({});
    export const rateLimit = () => ({ allowed: true, remaining: 99, resetTime: Date.now() + 60000 });
    export const logSecurityEvent = () => {};
    export const getClientIp = () => '127.0.0.1';
    export const validateJwtStructure = () => ({ valid: true });
    export const sanitizeString = (value) => String(value ?? '');
    export const validateInput = () => ({ valid: true });
    export const validateQuerySafety = () => ({ safe: true });
    export const validateFileUpload = () => ({ valid: true });
  `],
  ['./storage.ts', `
    export const isBlobsConfigured = () => false;
    export const putImage = async () => {};
    export const getImage = async () => null;
  `],
]);

describe('GET /listings/:id expired listings', () => {
  before(async () => {
    mkdirSync(TEMP_DIR, { recursive: true });
    await build({
      entryPoints: [join(ROOT, 'server/app.ts')],
      outfile: BUNDLE,
      bundle: true,
      format: 'esm',
      platform: 'node',
      plugins: [{
        name: 'listing-expiry-route-mocks',
        setup(build) {
          build.onResolve({ filter: /^\.\/(db|env|fcm|firebaseAdmin|security|storage)\.ts$/ }, (args) => {
            if (!mockModules.has(args.path)) return null;
            return { path: args.path, namespace: 'listing-expiry-route-mock' };
          });
          build.onLoad({ filter: /.*/, namespace: 'listing-expiry-route-mock' }, (args) => ({
            contents: mockModules.get(args.path),
            loader: 'js',
          }));
        },
      }],
    });
  });

  after(() => {
    if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it('returns 404 without hard-deleting expired listing records', async () => {
    testState.listing = {
      id: 'expired-listing',
      sellerId: 'seller-1',
      title: 'Expired tomatoes',
      status: 'active',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    testState.deletedListingIds = [];

    const { app } = await import(`${pathToFileURL(BUNDLE).href}?case=expired`);
    const response = await app.request('/make-server-dd877831/listings/expired-listing');

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Listing not found' });
    assert.deepEqual(testState.deletedListingIds, []);
  });

  it('keeps the mirrored expired-read handlers non-destructive', () => {
    for (const relativePath of ['server/app.ts', 'supabase/functions/_shared/app.ts']) {
      const source = readFileSync(join(ROOT, relativePath), 'utf8');
      const getListingRoute = source.slice(
        source.indexOf('app.get("/make-server-dd877831/listings/:id"'),
        source.indexOf('app.delete("/make-server-dd877831/listings/:id"'),
      );
      const expiredBranch = getListingRoute.slice(
        getListingRoute.indexOf('if (isListingExpired(listing))'),
        getListingRoute.indexOf('// Seller lookup should not fail the whole listing response.'),
      );

      assert.match(expiredBranch, /return c\.json\(\{ error: "Listing not found" \}, 404\);/);
      assert.doesNotMatch(expiredBranch, /deleteListingRecords|deleteListing/);
    }
  });
});
