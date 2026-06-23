// @ts-nocheck
// Ported Deno backend; type-checked by the Deno runtime, not the Vercel/Node build.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import * as kv from "./kv_store.ts";
import * as listingsIndex from "./listings_index.ts";
import * as security from "./security.ts";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "./env.ts";

const ADMIN_EMAIL = (() => {
  const adminEmail = getEnv('ADMIN_EMAIL');
  if (!adminEmail || adminEmail.trim() === '') {
    throw new Error('ADMIN_EMAIL environment variable is required for admin role assignment');
  }
  return adminEmail.toLowerCase();
})();

const SEED_RATER_EMAIL = (() => {
  const seedRaterEmail = getEnv('SEED_RATER_EMAIL');
  return seedRaterEmail ? seedRaterEmail.toLowerCase() : null;
})();

const APP_ID = (() => {
  const appId = getEnv('APP_ID');
  if (!appId || appId.trim() === '') {
    throw new Error('APP_ID environment variable must be configured for API routes and storage bucket naming.');
  }
  return appId;
})();

const STORAGE_BUCKET_NAME = (() => {
  const bucketName = getEnv('STORAGE_BUCKET_NAME');
  if (!bucketName || bucketName.trim() === '') {
    throw new Error('STORAGE_BUCKET_NAME environment variable must be configured.');
  }
  return bucketName;
})();

const KV_TABLE_NAME = (() => {
  const tableName = getEnv('KV_TABLE_NAME');
  if (!tableName || tableName.trim() === '') {
    throw new Error('KV_TABLE_NAME environment variable must be configured.');
  }
  return tableName;
})();

const CORS_ORIGINS = (() => {
  const origins = getEnv('CORS_ORIGINS');
  if (!origins || origins.trim() === '') {
    throw new Error('CORS_ORIGINS environment variable must be configured as comma-separated values.');
  }
  return origins.split(',').map(o => o.trim()).filter(Boolean);
})();

// Allow an origin if it's explicitly configured (CORS_ORIGINS), OR it's
// localhost on any port (local dev), OR it's a share-crops-v2 Vercel deployment
// (the production alias, the auto-generated project domain, or a preview URL).
// Returning the origin string tells Hono to echo it in Access-Control-Allow-Origin.
const isAllowedOrigin = (origin: string | undefined | null): string | null => {
  if (!origin) return null;
  if (CORS_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/share-crops-v2[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  return null;
};

const DEFAULT_ORIGIN = (() => {
  const origin = getEnv('DEFAULT_ORIGIN');
  return origin?.trim() || 'https://sharecrops.app';
})();

const API_PREFIX = `make-server-${APP_ID}`;

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Security: Add hardened CORS with specific origin validation
app.use(
  "/*",
  cors({
    origin: (origin) => isAllowedOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    maxAge: 600,
    credentials: true,
  }),
);

// Security: Add security headers middleware
app.use('/*', async (c, next) => {
  const headers = security.getSecurityHeaders();
  Object.entries(headers).forEach(([key, value]) => {
    c.header(key, value as string);
  });
  await next();
});

// Security: Rate limiting middleware
app.use('/*', async (c, next) => {
  const { allowed, remaining, resetTime } = security.rateLimit(c.req);

  c.header('X-RateLimit-Remaining', remaining.toString());
  c.header('X-RateLimit-Reset', resetTime.toString());

  if (!allowed) {
    security.logSecurityEvent('rate_limit_exceeded', 'medium', {
      ip: security.getClientIp(c.req),
      path: c.req.path,
      timestamp: new Date().toISOString(),
    });
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  await next();
});

// Supabase clients
const getServiceRoleClient = () => createClient(
  getEnv('SUPABASE_URL')!,
  getEnv('SUPABASE_SERVICE_ROLE_KEY')!,
);

const getAnonClient = () => createClient(
  getEnv('SUPABASE_URL')!,
  getEnv('SUPABASE_ANON_KEY')!,
);

// Initialize storage bucket
const initStorage = async () => {
  const supabase = getServiceRoleClient();

  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(bucket => bucket.name === STORAGE_BUCKET_NAME);

  if (!bucketExists) {
    await supabase.storage.createBucket(STORAGE_BUCKET_NAME, { public: false });
    console.log(`Created storage bucket: ${STORAGE_BUCKET_NAME}`);
  }
};

// Initialize mock ratings data
const initMockData = async () => {
  try {
    // Check if mock data already initialized
    const mockDataFlag = await kv.get('mock_data:initialized');
    if (mockDataFlag) {
      console.log('Mock data already initialized');
      return;
    }

    // Create mock sellers with ratings
    const mockSellers = [
      {
        id: 'seller-mock-1',
        email: 'seller@example.com',
        name: 'John\'s Garden',
        bio: 'Fresh organic vegetables from local garden',
        rating: 4.5,
        ratingCount: 8,
        profilePhotoUrl: '',
      },
      {
        id: 'seller-mock-2',
        email: 'alice@example.com',
        name: 'Alice\'s Farmers Market',
        bio: 'Seasonal produce, always fresh',
        rating: 4.8,
        ratingCount: 12,
        profilePhotoUrl: '',
      },
      {
        id: 'seller-mock-3',
        email: 'bob@example.com',
        name: 'Bob\'s Community Farm',
        bio: 'Supporting local agriculture',
        rating: 4.2,
        ratingCount: 5,
        profilePhotoUrl: '',
      },
    ];

    // Save mock sellers
    for (const seller of mockSellers) {
      const existingUser = await kv.get(`user:${seller.id}`);
      if (!existingUser) {
        await kv.set(`user:${seller.id}`, seller);
        console.log(`Created mock seller: ${seller.name}`);
      }
    }

    // Create mock community
    const communityId = 'community-mock-1';
    const existingCommunity = await kv.get(`community:id:${communityId}`);
    if (!existingCommunity) {
      const mockCommunity = {
        id: communityId,
        name: 'Demo Community',
        zipCode: '12345',
        createdBy: 'seller-mock-1',
        memberCount: mockSellers.length,
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await kv.set(`community:id:${communityId}`, mockCommunity);
      await kv.set(`community:12345:Demo Community`, mockCommunity);
      console.log('Created mock community');
    }

    // Create mock ratings for each seller
    for (const seller of mockSellers) {
      const ratingCount = seller.ratingCount;
      for (let i = 0; i < ratingCount; i++) {
        const ratingId = crypto.randomUUID();
        const rating = seller.rating + (Math.random() * 0.5 - 0.25); // Slight variation
        const mockRating = {
          id: ratingId,
          offerId: `offer-mock-${seller.id}-${i}`,
          ratedUserId: seller.id,
          raterUserId: `buyer-mock-${i}`,
          rating: Math.round(Math.max(1, Math.min(5, rating)) * 2) / 2, // Round to 0.5
          comment: [
            'Great exchange! Highly recommend.',
            'Fresh produce, very reliable seller.',
            'Perfect quality and communication.',
            'Will definitely buy again.',
            'Best seller in our community.',
            'Amazing vegetables and fair pricing.',
            'Professional and trustworthy.',
            'Excellent service and quality.',
            'Consistently great products.',
            'Happy with every transaction.',
            'Highly satisfied with the produce.',
            'Wonderful community member.',
          ][i % 12],
          createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

        // Only store if not already exists
        const existingRating = await kv.get(`rating:user:${seller.id}:${ratingId}`);
        if (!existingRating) {
          await kv.set(`rating:${ratingId}`, mockRating);
          await kv.set(`rating:user:${seller.id}:${ratingId}`, mockRating);
        }
      }
    }

    // Create mock listings for sellers
    const mockListings = [
      {
        title: 'Fresh Tomatoes',
        description: 'Ripe red tomatoes picked fresh from the garden',
        quantity: '5 lbs',
        sellerId: 'seller-mock-1',
        communityId: 'community-mock-1',
      },
      {
        title: 'Organic Lettuce',
        description: 'Crisp organic lettuce, perfect for salads',
        quantity: '2 bunches',
        sellerId: 'seller-mock-2',
        communityId: 'community-mock-1',
      },
      {
        title: 'Homegrown Peppers',
        description: 'Assorted sweet and hot peppers',
        quantity: '1 dozen',
        sellerId: 'seller-mock-3',
        communityId: 'community-mock-1',
      },
      {
        title: 'Fresh Basil',
        description: 'Fragrant fresh basil for cooking',
        quantity: '1 bunch',
        sellerId: 'seller-mock-1',
        communityId: 'community-mock-1',
      },
      {
        title: 'Zucchini',
        description: 'Green zucchini, great for grilling',
        quantity: '3 medium',
        sellerId: 'seller-mock-2',
        communityId: 'community-mock-1',
      },
    ];

    for (const listingData of mockListings) {
      const listingId = `listing-mock-${crypto.randomUUID().substring(0, 8)}`;
      const existingListing = await kv.get(`listing:${listingId}`);
      
      if (!existingListing) {
        const mockListing = {
          id: listingId,
          title: listingData.title,
          description: listingData.description,
          quantity: listingData.quantity,
          sellerId: listingData.sellerId,
          communityId: listingData.communityId,
          status: 'active',
          photos: [],
          lookingFor: 'Open to reasonable offers',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date(Date.now() - Math.random() * 14 * 24 * 60 * 60 * 1000).toISOString(),
          seller: mockSellers.find(s => s.id === listingData.sellerId),
          zipCode: '12345',
        };

        await kv.set(`listing:${listingId}`, mockListing);
        await kv.set(`listing:community:${listingData.communityId}:${listingId}`, mockListing);
        console.log(`Created mock listing: ${mockListing.title}`);
      }
    }

    // Mark mock data as initialized
    await kv.set('mock_data:initialized', { timestamp: new Date().toISOString() });
    console.log('Mock rating data initialized successfully');
  } catch (error) {
    console.error('Failed to initialize mock data:', error);
  }
};

// Ensure tempUser has visible listing rankings seeded by another user.
const seedTempUserRatings = async () => {
  try {
    const targetEmails = ['tempUser@share-crops.com', 'userTemp@share-crops.com'];
    const raterEmail = SEED_RATER_EMAIL;
    if (!raterEmail) {
      console.log('SEED_RATER_EMAIL not configured; skipping tempUser rating seed');
      return;
    }
    const userIds = await findAuthUserIdsByEmails([...targetEmails, raterEmail]);
    const tempUserId = targetEmails
      .map((email) => userIds[email.toLowerCase()])
      .find((id) => !!id) ?? null;
    let raterUserId = userIds[raterEmail.toLowerCase()] ?? null;

    if (!tempUserId) {
      console.log('tempUser not found; skipping tempUser rating seed');
      return;
    }

    // If the requested rater account does not exist yet, keep deterministic seed data.
    if (!raterUserId) {
      raterUserId = 'seed-rater-gilbert';
    }

    const seedRatings = [
      { rating: 5, comment: 'Great quality produce and very responsive.' },
      { rating: 4, comment: 'Smooth exchange and exactly as described.' },
      { rating: 5, comment: 'Excellent local grower. Would trade again.' },
    ];

    for (let i = 0; i < seedRatings.length; i++) {
      const ratingId = `seed-tempuser-${tempUserId}-${i + 1}`;
      const offerId = `seed-offer-tempuser-${i + 1}`;
      const createdAt = new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000).toISOString();
      const seededRating = {
        id: ratingId,
        offerId,
        ratedUserId: tempUserId,
        raterUserId,
        rating: seedRatings[i].rating,
        comment: seedRatings[i].comment,
        createdAt,
      };

      // Deterministic IDs keep this seed idempotent across restarts.
      await kv.set(`rating:${ratingId}`, seededRating);
      await kv.set(`rating:${offerId}:${raterUserId}`, seededRating);
      await kv.set(`rating:user:${tempUserId}:${ratingId}`, seededRating);
    }

    // Recompute and persist aggregate score for profile/listing badges.
    const allRatings = await kv.getByPrefix(`rating:user:${tempUserId}:`);
    const count = allRatings.length;
    const avg = count
      ? allRatings.reduce((sum: number, r: any) => sum + (Number(r.rating) || 0), 0) / count
      : 0;

    const tempProfile = await kv.get(`user:${tempUserId}`);
    if (tempProfile) {
      tempProfile.rating = Math.round(avg * 10) / 10;
      tempProfile.ratingCount = count;
      await kv.set(`user:${tempUserId}`, tempProfile);
    }

    console.log(`Seeded tempUser ratings: ${count} total (avg ${Math.round(avg * 10) / 10})`);
  } catch (error) {
    console.error('Failed to seed tempUser ratings:', error);
  }
};

// Seed offers on tempUser's listings so they appear in community rankings.
const seedTempUserListingOffers = async () => {
  try {
    const targetEmails = ['tempUser@share-crops.com', 'userTemp@share-crops.com'];
    const raterEmail = SEED_RATER_EMAIL;
    if (!raterEmail) {
      console.log('SEED_RATER_EMAIL not configured; skipping listing offer seed');
      return;
    }
    const userIds = await findAuthUserIdsByEmails([...targetEmails, raterEmail]);
    const tempUserId = targetEmails
      .map((email) => userIds[email.toLowerCase()])
      .find((id) => !!id) ?? null;
    let raterUserId = userIds[raterEmail.toLowerCase()] ?? null;

    if (!tempUserId) {
      console.log('tempUser not found; skipping listing offer seed');
      return;
    }
    if (!raterUserId) raterUserId = 'seed-buyer-gilbert';

    // Find all active listings owned by tempUser
    const allListings = await kv.getByPrefix('listing:community:');
    const tempUserListings = allListings.filter(
      (l: any) => l && typeof l === 'object' && l.sellerId === tempUserId && l.status === 'active'
    );

    if (!tempUserListings.length) {
      console.log('No tempUser listings found; skipping listing offer seed');
      return;
    }

    // Seed buyers to distribute offers across multiple "users" for realistic rankings
    const seedBuyers = [
      raterUserId,
      'seed-buyer-neighbor-1',
      'seed-buyer-neighbor-2',
      'seed-buyer-neighbor-3',
    ];

    const seedOfferedProduce = [
      '1 dozen eggs',
      'fresh herbs bundle',
      '3 lbs carrots',
      '2 lbs cherry tomatoes',
    ];

    let seededCount = 0;
    for (let li = 0; li < tempUserListings.length; li++) {
      const listing = tempUserListings[li];
      // Give each listing a varying number of offers so ranks differ (2–4 offers each)
      const offerCount = 2 + (li % 3);
      for (let oi = 0; oi < offerCount; oi++) {
        const buyerId = seedBuyers[oi % seedBuyers.length];
        // Deterministic offer ID so this is idempotent across restarts
        const offerId = `seed-offer-rank-${listing.id}-${oi}`;
        const existing = await kv.get(`offer:${offerId}`);
        if (existing) continue;

        const offer = {
          id: offerId,
          listingId: listing.id,
          buyerId,
          sellerId: tempUserId,
          offeredProduce: seedOfferedProduce[oi % seedOfferedProduce.length],
          message: 'Interested in a trade!',
          status: 'pending',
          createdAt: new Date(Date.now() - (li * 12 + oi * 3) * 60 * 60 * 1000).toISOString(),
        };

        await kv.set(`offer:${offerId}`, offer);
        await kv.set(`offer:listing:${listing.id}:${offerId}`, offer);
        await kv.set(`offer:buyer:${buyerId}:${offerId}`, offer);
        await kv.set(`offer:seller:${tempUserId}:${offerId}`, offer);
        seededCount++;
      }
    }

    console.log(`Seeded ${seededCount} ranking offers across ${tempUserListings.length} tempUser listings`);
  } catch (error) {
    console.error('Failed to seed tempUser listing offers:', error);
  }
};

// Initialize on startup
if (getEnv("SKIP_INIT") !== "true") {
  initStorage();
  initMockData();
  seedTempUserRatings();
  seedTempUserListingOffers();
}

// Helper: Get authenticated user
const getAuthUser = async (authHeader: string | null) => {
  if (!authHeader) {
    security.logSecurityEvent('missing_auth_header', 'medium', { timestamp: new Date().toISOString() });
  }

  // Validate token structure
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    security.logSecurityEvent('invalid_auth_format', 'medium', { 
      format: parts[0],
      timestamp: new Date().toISOString() 
    });
    return null;
  }

  const token = parts[1];

  // Validate token structure (basic JWT validation)
  const tokenValidation = security.validateJwtStructure(token);
  if (!tokenValidation.valid) {
    security.logSecurityEvent('invalid_token_structure', 'high', {
      error: tokenValidation.error,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  try {
    const supabase = getServiceRoleClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      security.logSecurityEvent('auth_error', 'high', {
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (!user) {
      security.logSecurityEvent('no_user_in_token', 'medium', {
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    // Validate user object has required fields
    if (!user.id || !user.email) {
      security.logSecurityEvent('incomplete_user_data', 'high', {
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    return user;
  } catch (error) {
    security.logSecurityEvent('auth_exception', 'critical', {
      error: String(error),
      timestamp: new Date().toISOString(),
    });

  if (!profile) {
    security.logSecurityEvent('missing_user_profile', 'medium', {
      userId,
      timestamp: new Date().toISOString(),
    });
    return 'general';
  }

  if (typeof profile.role !== 'string') {
    security.logSecurityEvent('invalid_user_role', 'medium', {
      userId,
      timestamp: new Date().toISOString(),
    });
    return 'general';
  }

  return normalizeUserRole(profile.role);
  }
};

const normalizeUserRole = (role: unknown): 'admin' | 'general' => {
  return role === 'admin' || role === 'general' ? role : 'general';
};

const getUserRole = async (userId: string): Promise<'admin' | 'general'> => {
  const profile = await kv.get(`user:${userId}`);
  return normalizeUserRole(profile?.role);
};

// Maintain admin index for efficient lookups
const setAdminIndex = async (userId: string, isAdmin: boolean) => {
  const indexKey = `role:admin:${userId}`;
  if (isAdmin) {
    await kv.set(indexKey, { userId, setAt: new Date().toISOString() });
  } else {
    await kv.del(indexKey);
  }
};

const MAX_LISTING_EXPIRATION_DAYS = 30;

const getCommunityMembershipKey = (userId: string, communityId: string) =>
  `user:${userId}:community_member:${communityId}`;

const addMembership = async (userId: string, communityId: string) => {
  await kv.set(getCommunityMembershipKey(userId, communityId), {
    userId,
    communityId,
    joinedAt: new Date().toISOString(),
  });
};

const getMembershipCommunityIds = async (userId: string): Promise<string[]> => {
  const memberships = await kv.getByPrefix(`user:${userId}:community_member:`);
  if (!Array.isArray(memberships)) return [];

  const ids = memberships
    .map((m: any) => m?.communityId)
    .filter((id: any) => typeof id === 'string');

  return [...new Set(ids)];
};

const getMembershipCommunities = async (userId: string): Promise<any[]> => {
  const communityIds = await getMembershipCommunityIds(userId);
  const communities: any[] = [];

  for (const id of communityIds) {
    const community = await kv.get(`community:id:${id}`);
    if (community) {
      communities.push(community);
    }
  }

  return communities;
};

// Sync memberCount for a community by counting actual members
const syncCommunityMemberCount = async (communityId: string): Promise<number> => {
  const members = await kv.getByPrefix(`community:member:${communityId}:`);
  const actualCount = Array.isArray(members) ? members.length : 0;

  const community = await kv.get(`community:id:${communityId}`);
  if (community) {
    community.memberCount = actualCount;
    await kv.set(`community:id:${communityId}`, community);
    await kv.set(`community:${community.zipCode}:${community.name.toLowerCase().trim()}`, community);
  }

  return actualCount;
};

const findAuthUserIdsByEmails = async (emails: string[]): Promise<Record<string, string | null>> => {
  const targets = new Map(emails.map((email) => [email.toLowerCase(), null as string | null]));
  const supabase = getServiceRoleClient();

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      console.error('Failed to list auth users for email lookup:', error);
      break;
    }

    const users = data?.users ?? [];
    if (!users.length) break;

    for (const authUser of users) {
      const email = authUser.email?.toLowerCase();
      if (email && targets.has(email) && !targets.get(email)) {
        targets.set(email, authUser.id);
      }
    }

    if ([...targets.values()].every(Boolean)) break;
  }

  return Object.fromEntries(targets);
};

const isListingExpired = (listing: any): boolean => {
  if (!listing?.expiresAt) return false;
  const expiresAt = new Date(listing.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt;
};

const deleteListingRecords = async (listing: any) => {
  if (!listing?.id) return;

  await kv.del(`listing:${listing.id}`);

  if (listing.communityId) {
    await kv.del(`listing:community:${listing.communityId}:${listing.id}`);
  }

  if (listing.sellerId) {
    await kv.del(`listing:user:${listing.sellerId}:${listing.id}`);
  }

  await listingsIndex.removeListing(listing.id);
};

const toSerializableObject = (value: any): any | null => {
  if (!value || typeof value !== 'object') return null;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

// Health check endpoint
app.get(`/${API_PREFIX}/health`, (c) => {
  return c.json({ status: "ok" });
});

// ===== AUTH ROUTES =====

app.post("/make-server-dd877831/auth/signup", async (c) => {
  try {
    // Body-size guard — reject before JSON parsing to prevent memory exhaustion
    const contentLength = parseInt(c.req.header('content-length') || '0', 10);
    if (contentLength > 4096) {
      security.logSecurityEvent('oversized_auth_request', 'medium', {
        ip: security.getClientIp(c.req),
        size: contentLength,
      });
      return c.json({ error: 'Request too large' }, 413);
    }

    const { email, password, name } = await c.req.json();

    // Input validation
    if (!email || !password || !name) {
      return c.json({ error: "Email, password, and name are required" }, 400);
    }

    // Validate email format
    const emailValidation = security.validateInput(email, 'email');
    if (!emailValidation.valid) {
      security.logSecurityEvent('invalid_email_format', 'low', { email });
      return c.json({ error: "Invalid email format" }, 400);
    }

    // Validate name
    const nameValidation = security.validateInput(name, 'string', { minLength: 1, maxLength: 100 });
    if (!nameValidation.valid) {
      security.logSecurityEvent('invalid_name_format', 'low', { name });
      return c.json({ error: "Name must be 1-100 characters" }, 400);
    }

    // Validate password strength (min 8 chars, at least 1 uppercase, 1 number)
    if (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      return c.json({ error: "Password must be at least 8 characters with uppercase and numbers" }, 400);
        console.log('Initializing mock data...');
    }

    // Prevent SQL injection patterns
    const sqlSafety = security.validateQuerySafety(email + name);
    if (!sqlSafety.safe) {
      security.logSecurityEvent('sql_injection_attempt', 'high', {
        ip: security.getClientIp(c.req),
        email: email.substring(0, 5),
      });
      return c.json({ error: "Invalid input detected" }, 400);
    }

    const supabase = getServiceRoleClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true
    });

    if (error) {
      console.error("Signup error:", error);
      security.logSecurityEvent('signup_error', 'medium', { error: error.message });
      return c.json({ error: error.message }, 400);
    }

    // Sanitize user data before storing
    await kv.set(`user:${data.user.id}`, {
      id: data.user.id,
      email: security.sanitizeString(email),
      name: security.sanitizeString(name),
      bio: '',
      socialUrl: '',
      profilePhotoUrl: '',
      rating: 0,
      ratingCount: 0,
      role: email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'general',
      createdAt: new Date().toISOString(),
    });

    security.logSecurityEvent('user_signup', 'low', { userId: data.user.id });
    return c.json({ success: true, userId: data.user.id });
  } catch (error) {
    console.error("Signup error:", error);
    security.logSecurityEvent('signup_exception', 'critical', { error: String(error) });
    return c.json({ error: "Signup failed" }, 500);
  }
});

app.post("/make-server-dd877831/auth/login", async (c) => {
  try {
    // Body-size guard — reject before JSON parsing to prevent memory exhaustion
    const contentLength = parseInt(c.req.header('content-length') || '0', 10);
    if (contentLength > 4096) {
      security.logSecurityEvent('oversized_auth_request', 'medium', {
        ip: security.getClientIp(c.req),
        size: contentLength,
      });
      return c.json({ error: 'Request too large' }, 413);
    }

    // Auth-specific rate limit (tighter than global 100/min)
    const authLimit = security.authRateLimit(c.req);
    if (!authLimit.allowed) {
      c.header('Retry-After', Math.ceil((authLimit.resetTime - Date.now()) / 1000).toString());
      security.logSecurityEvent('auth_rate_limit_exceeded', 'medium', {
        ip: security.getClientIp(c.req),
      });
      return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
    }

    const { email, password } = await c.req.json();
    const ip = security.getClientIp(c.req);

    // Input validation
    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Validate email format
    const emailValidation = security.validateInput(email, 'email');
    if (!emailValidation.valid) {
      security.logSecurityEvent('invalid_login_email', 'low', { ip });
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Per-email / per-IP lockout check
    const lockout = security.isLockedOut(email, ip);
    if (lockout.locked) {
      c.header('Retry-After', lockout.retryAfter.toString());
      security.logSecurityEvent('lockout_enforced', 'medium', {
        ip,
        email: email.substring(0, 3),
      });
      return c.json({ error: 'Account temporarily locked due to too many failed attempts. Please try again later.' }, 429);
    }

    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error("Login error:", error);
      security.trackFailedLogin(email, ip);
      // Artificial delay: uniform response time prevents timing-based enumeration
      await new Promise((resolve) => setTimeout(resolve, 500));
      security.logSecurityEvent('login_failed', 'low', {
        ip,
        email: email.substring(0, 5),
      });
      return c.json({ error: "Invalid credentials" }, 401);
    }

    security.resetFailedLogin(email);
    security.logSecurityEvent('user_login', 'low', { userId: data.user.id });
    return c.json({
      success: true,
      accessToken: data.session.access_token,
      userId: data.user.id
    });
  } catch (error) {
    console.error("Login error:", error);
    security.logSecurityEvent('login_exception', 'critical', { error: String(error) });
    return c.json({ error: "Login failed" }, 500);
  }
});

app.post("/make-server-dd877831/auth/reset-password", async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ error: "Email is required" }, 400);
    }

    const emailValidation = security.validateInput(email, 'email');
    if (!emailValidation.valid) {
      // Return success even on invalid email to avoid user enumeration
      return c.json({ success: true });
    }

    const supabase = getAnonClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${c.req.header('Origin') || DEFAULT_ORIGIN}/reset-password`,
    });

    // Always return success to avoid leaking whether email exists
    security.logSecurityEvent('password_reset_requested', 'low', { email: email.substring(0, 3) });
    return c.json({ success: true });
  } catch (error) {
    console.error("Password reset error:", error);
    return c.json({ success: true }); // Still return success to avoid enumeration
  }
});

app.get("/make-server-dd877831/auth/me", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let profile = await kv.get(`user:${user.id}`);

  // Auto-provision a profile for users created outside the email/password
  // signup flow (e.g. Google OAuth), who have a valid Supabase identity but no
  // app profile yet. Mirrors the shape written by /auth/signup.
  if (!profile) {
    const meta = user.user_metadata || {};
    const rawName = meta.full_name || meta.name || user.email.split('@')[0];
    profile = {
      id: user.id,
      email: security.sanitizeString(user.email),
      name: security.sanitizeString(String(rawName)),
      bio: '',
      socialUrl: '',
      profilePhotoUrl: meta.avatar_url || meta.picture || '',
      rating: 0,
      ratingCount: 0,
      role: user.email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'general',
      createdAt: new Date().toISOString(),
    };
    await kv.set(`user:${user.id}`, profile);
    security.logSecurityEvent('oauth_user_provisioned', 'low', { userId: user.id });
  }

  // Backfill role for accounts created before roles were introduced
  if (profile && profile.role === undefined) {
    profile.role = profile.email?.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'general';
    await kv.set(`user:${user.id}`, profile);
  }

  return c.json({ user: profile });
});

// ===== COMMUNITY ROUTES =====

app.post("/make-server-dd877831/communities", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { name, zipCode } = await c.req.json();

    if (!name || !zipCode) {
      return c.json({ error: "Name and zip code are required" }, 400);
    }

    // Normalize for duplicate check
    const normalizedName = name.toLowerCase().trim();
    const normalizedZip = zipCode.trim();
    const communityKey = `community:${normalizedZip}:${normalizedName}`;

    // Check for duplicate
    const existing = await kv.get(communityKey);
    if (existing) {
      return c.json({ error: "A community with this name already exists in this zip code", duplicate: true }, 409);
    }

    const communityId = crypto.randomUUID();
    const community = {
      id: communityId,
      name,
      zipCode,
      createdBy: user.id,
      memberCount: 1,
      createdAt: new Date().toISOString(),
    };

    await kv.set(communityKey, community);
    await kv.set(`community:id:${communityId}`, community);
    await kv.set(`user:${user.id}:community`, communityId);
    await addMembership(user.id, communityId);

    return c.json({ success: true, community });
  } catch (error) {
    console.error("Create community error:", error);
    return c.json({ error: "Failed to create community" }, 500);
  }
});

app.post("/make-server-dd877831/communities/join", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { communityId } = await c.req.json();

    if (!communityId) {
      return c.json({ error: "Community ID is required" }, 400);
    }

    const community = await kv.get(`community:id:${communityId}`);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const existingMembership = await kv.get(getCommunityMembershipKey(user.id, communityId));

    // Already a member: make this active community and return success.
    if (existingMembership) {
      await kv.set(`user:${user.id}:community`, communityId);
      return c.json({ success: true, community, alreadyMember: true });
    }

    await kv.set(`user:${user.id}:community`, communityId);
    await addMembership(user.id, communityId);
    await kv.set(`community:member:${communityId}:${user.id}`, { userId: user.id, communityId, joinedAt: new Date().toISOString() });

    // Sync member count to ensure accuracy
    await syncCommunityMemberCount(communityId);
    const updatedCommunity = await kv.get(`community:id:${communityId}`);

    return c.json({ success: true, community: updatedCommunity });
  } catch (error) {
    console.error("Join community error:", error);
    return c.json({ error: "Failed to join community" }, 500);
  }
});

app.get("/make-server-dd877831/communities/search", async (c) => {
  try {
    const zipCode = c.req.query('zipCode');
    if (!zipCode) {
      return c.json({ error: "Zip code is required" }, 400);
    }

    const normalizedZip = zipCode.trim();
    const raw = await kv.getByPrefix(`community:${normalizedZip}:`);

    // Only return communities whose stored zipCode matches the searched zip.
    // Guards against stale index entries or data written under unexpected keys.
    const communities = raw.filter(
      (entry: any) => entry && typeof entry === 'object' && entry.zipCode?.trim() === normalizedZip
    );

    return c.json({ communities });
  } catch (error) {
    console.error("Search communities error:", error);
    return c.json({ error: "Failed to search communities" }, 500);
  }
});

app.get("/make-server-dd877831/communities/my", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    let communityId = await kv.get(`user:${user.id}:community`);

    if (!communityId) {
      const communityIds = await getMembershipCommunityIds(user.id);
      if (communityIds.length > 0) {
        communityId = communityIds[0];
        await kv.set(`user:${user.id}:community`, communityId);
      }
    }

    if (!communityId) {
      return c.json({ community: null });
    }

    const community = await kv.get(`community:id:${communityId}`);

    if (!community) {
      await kv.del(`user:${user.id}:community`);
      return c.json({ community: null });
    }

    return c.json({ community });
  } catch (error) {
    console.error("Get my community error:", error);
    return c.json({ error: "Failed to get community" }, 500);
  }
});

app.get("/make-server-dd877831/communities/mine", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const communities = await getMembershipCommunities(user.id);
    const activeCommunityId = await kv.get(`user:${user.id}:community`);
    return c.json({ communities, activeCommunityId });
  } catch (error) {
    console.error("Get my communities error:", error);
    return c.json({ error: "Failed to get communities" }, 500);
  }
});

app.post("/make-server-dd877831/communities/active", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { communityId } = await c.req.json();

    if (!communityId) {
      return c.json({ error: "Community ID is required" }, 400);
    }

    const membership = await kv.get(getCommunityMembershipKey(user.id, communityId));
    if (!membership) {
      return c.json({ error: "You are not a member of this community" }, 403);
    }

    const community = await kv.get(`community:id:${communityId}`);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    await kv.set(`user:${user.id}:community`, communityId);
    return c.json({ success: true, community });
  } catch (error) {
    console.error("Set active community error:", error);
    return c.json({ error: "Failed to set active community" }, 500);
  }
});

app.delete("/make-server-dd877831/communities/mine/:communityId", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const communityId = c.req.param('communityId');
    const membershipKey = getCommunityMembershipKey(user.id, communityId);
    const membership = await kv.get(membershipKey);

    if (!membership) {
      return c.json({ error: "You are not a member of this community" }, 404);
    }

    const community = await kv.get(`community:id:${communityId}`);
    if (community) {
      community.memberCount = Math.max((community.memberCount || 1) - 1, 0);
      await kv.set(`community:id:${communityId}`, community);
      await kv.set(`community:${community.zipCode}:${community.name.toLowerCase().trim()}`, community);
    }

    await kv.del(membershipKey);
    await kv.del(`community:member:${communityId}:${user.id}`);

    const activeCommunityId = await kv.get(`user:${user.id}:community`);
    if (activeCommunityId === communityId) {
      const remainingIds = await getMembershipCommunityIds(user.id);
      if (remainingIds.length > 0) {
        await kv.set(`user:${user.id}:community`, remainingIds[0]);
      } else {
        await kv.del(`user:${user.id}:community`);
      }
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Leave community error:", error);
    return c.json({ error: "Failed to leave community" }, 500);
  }
});

app.get("/make-server-dd877831/communities/:communityId/members/preview", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const communityId = c.req.param('communityId');

    // Use consistent getByPrefix pattern from full members endpoint
    const memberEntries = await kv.getByPrefix(`community:member:${communityId}:`);

    // Limit to 12 members for preview
    const previewEntries = memberEntries.slice(0, 12);

    // Batch fetch profiles
    const members = await Promise.all(
      previewEntries.map(async (entry: any) => {
        const profile = await kv.get(`user:${entry.userId}`);
        return profile ? { id: entry.userId, name: profile.name, profilePhotoUrl: profile.profilePhotoUrl ?? null } : null;
      })
    );

    return c.json({ members: members.filter(Boolean) });
  } catch (error) {
    console.error("Get community members preview error:", error);
    return c.json({ error: "Failed to get members" }, 500);
  }
});

app.get("/make-server-dd877831/communities/:communityId/members", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const role = await getUserRole(user.id);
  if (role !== 'admin') return c.json({ error: "Forbidden" }, 403);

  try {
    const communityId = c.req.param('communityId');
    const memberEntries = await kv.getByPrefix(`community:member:${communityId}:`);
    const members = await Promise.all(
      memberEntries.map(async (entry: any) => {
        const profile = await kv.get(`user:${entry.userId}`);
        return profile ? { ...profile, joinedAt: entry.joinedAt } : null;
      })
    );
    return c.json({ members: members.filter(Boolean) });
  } catch (error) {
    console.error("Get community members error:", error);
    return c.json({ error: "Failed to get members" }, 500);
  }
});

app.delete("/make-server-dd877831/communities/:communityId/members/:userId", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const role = await getUserRole(user.id);
  if (role !== 'admin') return c.json({ error: "Forbidden" }, 403);

  try {
    const communityId = c.req.param('communityId');
    const targetUserId = c.req.param('userId');

    const membershipKey = getCommunityMembershipKey(targetUserId, communityId);
    const membership = await kv.get(membershipKey);
    if (!membership) return c.json({ error: "User is not a member of this community" }, 404);

    await kv.del(membershipKey);
    await kv.del(`community:member:${communityId}:${targetUserId}`);

    // Sync member count to ensure accuracy
    await syncCommunityMemberCount(communityId);

    const activeCommunityId = await kv.get(`user:${targetUserId}:community`);
    if (activeCommunityId === communityId) {
      const remainingIds = await getMembershipCommunityIds(targetUserId);
      if (remainingIds.length > 0) {
        await kv.set(`user:${targetUserId}:community`, remainingIds[0]);
      } else {
        await kv.del(`user:${targetUserId}:community`);
      }
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Remove community member error:", error);
    return c.json({ error: "Failed to remove member" }, 500);
  }
});

app.get("/make-server-dd877831/communities/all", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const role = await getUserRole(user.id);
  if (role !== 'admin') return c.json({ error: "Forbidden" }, 403);

  try {
    const allCommunities = await kv.getByPrefix('community:id:');
    return c.json({ communities: allCommunities.filter(Boolean) });
  } catch (error) {
    console.error("Get all communities error:", error);
    return c.json({ error: "Failed to get communities" }, 500);
  }
});

// One-time admin cleanup: remove all members from a community
app.post("/make-server-dd877831/admin/communities/:communityId/clear-members", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = await getUserRole(user.id);
  if (role !== 'admin') return c.json({ error: "Forbidden" }, 403);

  try {
    const body = await c.req.json().catch(() => ({}));
    if (body?.confirm !== 'CLEAR_MEMBERS') {
      return c.json({ error: 'Missing confirmation. Send { "confirm": "CLEAR_MEMBERS" } in the request body.' }, 400);
    }

    const communityId = c.req.param('communityId');

    // Get all reverse-index member records for this community
    const memberEntries = await kv.getByPrefix(`community:member:${communityId}:`);
    let removed = 0;

    for (const entry of memberEntries) {
      if (!entry?.userId) continue;
      const userId = entry.userId;

      // Remove both index directions
      await kv.del(`community:member:${communityId}:${userId}`);
      await kv.del(getCommunityMembershipKey(userId, communityId));

      // If this was the user's active community, clear it
      const activeCommunityId = await kv.get(`user:${userId}:community`);
      if (activeCommunityId === communityId) {
        await kv.del(`user:${userId}:community`);
      }
      removed++;
    }

    // Sync member count to ensure accuracy (should be 0 after clearing)
    await syncCommunityMemberCount(communityId);

    return c.json({ success: true, removed });
  } catch (error) {
    console.error("Clear members error:", error);
    return c.json({ error: "Failed to clear members" }, 500);
  }
});

// ===== LISTING ROUTES =====

app.post("/make-server-dd877831/listings", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { title, description, quantity, photos, lookingFor, expiresInDays } = await c.req.json();

    // Input validation
    const titleValidation = security.validateInput(title, 'string', { minLength: 1, maxLength: 200 });
    if (!titleValidation.valid) {
      security.logSecurityEvent('invalid_listing_title', 'low', { userId: user.id });
      return c.json({ error: "Title must be 1-200 characters" }, 400);
    }

    const descValidation = security.validateInput(description, 'string', { minLength: 0, maxLength: 2000 });
    if (!descValidation.valid) {
      return c.json({ error: "Description must be 0-2000 characters" }, 400);
    }

    const quantityValidation = security.validateInput(quantity, 'string', { minLength: 1, maxLength: 100 });
    if (!quantityValidation.valid) {
      return c.json({ error: "Quantity must be specified" }, 400);
    }

    const photosValidation = security.validateInput(photos || [], 'array', { maxItems: 5 });
    if (!photosValidation.valid) {
      security.logSecurityEvent('invalid_photos_array', 'low', { userId: user.id });
      return c.json({ error: "Maximum 5 photos allowed" }, 400);
    }

    const lookingForValidation = security.validateInput(lookingFor || '', 'string', { maxLength: 500 });
    if (!lookingForValidation.valid) {
      return c.json({ error: "Looking for description must be 0-500 characters" }, 400);
    }

    // Validate expiration
    const parsedExpiration = Number(expiresInDays ?? 30);
    if (!Number.isInteger(parsedExpiration) || parsedExpiration < 1 || parsedExpiration > MAX_LISTING_EXPIRATION_DAYS) {
      return c.json({ error: `Expiration must be an integer between 1 and ${MAX_LISTING_EXPIRATION_DAYS} days` }, 400);
    }

    // Prevent SQL injection in text fields
    const sqlSafety = security.validateQuerySafety(title + description + quantity);
    if (!sqlSafety.safe) {
      security.logSecurityEvent('sql_injection_in_listing', 'high', { userId: user.id });
      return c.json({ error: "Invalid characters detected in input" }, 400);
    }

    const communityId = await kv.get(`user:${user.id}:community`);
    if (!communityId) {
      return c.json({ error: "You must join a community first" }, 400);
    }

    const community = await kv.get(`community:id:${communityId}`);

    const listingId = crypto.randomUUID();
    const listing = {
      id: listingId,
      sellerId: user.id,
      title: security.sanitizeString(title),
      description: security.sanitizeString(description),
      quantity: security.sanitizeString(quantity),
      photos: photos || [],
      lookingFor: security.sanitizeString(lookingFor || ''),
      communityId,
      zipCode: community.zipCode,
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + parsedExpiration * 24 * 60 * 60 * 1000).toISOString(),
    };

    await kv.set(`listing:${listingId}`, listing);
    await kv.set(`listing:community:${communityId}:${listingId}`, listing);
    await kv.set(`listing:user:${user.id}:${listingId}`, listing);
    await listingsIndex.upsertListing(listing);

    security.logSecurityEvent('listing_created', 'low', { userId: user.id, listingId });
    return c.json({ success: true, listing });
  } catch (error) {
    console.error("Create listing error:", error);
    security.logSecurityEvent('create_listing_exception', 'critical', { error: String(error) });
    return c.json({ error: "Failed to create listing" }, 500);
  }
});

app.get("/make-server-dd877831/listings", async (c) => {
  try {
    const communityId = c.req.query('communityId');
    const zipCode = c.req.query('zipCode');
    const cursor = c.req.query('cursor');
    const limit = Number(c.req.query('limit') ?? 50);

    // Indexed, keyset-paginated read from the secondary index — active &
    // non-expired, newest-first — instead of scanning every listing:community:
    // key and filtering/sorting in JS.
    const { listings, nextCursor } = await listingsIndex.queryListings({
      communityId: communityId || null,
      zipCode: zipCode || null,
      limit: Number.isFinite(limit) ? limit : 50,
      cursor: cursor || null,
    });

    return c.json({ listings, nextCursor });
  } catch (error) {
    console.error("Get listings error:", error);
    return c.json({ error: "Failed to get listings" }, 500);
  }
});

app.get("/make-server-dd877831/listings/:id", async (c) => {
  try {
    const id = c.req.param('id');
    console.log(`[GET /listings/:id] Fetching listing with id: ${id}`);

    if (!id || typeof id !== 'string') {
      return c.json({ error: "Listing not found" }, 404);
    }
    
    // Prefer canonical listing key first; fallback to community index for legacy data.
    let listing: any = null;
    try {
      const primaryListing = await kv.get(`listing:${id}`);
      if (primaryListing && typeof primaryListing === 'object') {
        listing = primaryListing;
      } else {
        const allCommunityListings = await kv.getByPrefix('listing:community:');
        if (Array.isArray(allCommunityListings)) {
          listing = allCommunityListings.find((l: any) => l && typeof l === 'object' && l.id === id) || null;
        }
      }
    } catch (searchError) {
      console.error(`[GET /listings/:id] Community index search failed:`, searchError);
      return c.json({ error: "Failed to get listing" }, 500);
    }

    if (!listing || typeof listing !== 'object') {
      console.log(`[GET /listings/:id] Listing not found or invalid type`);
      return c.json({ error: "Listing not found" }, 404);
    }

    const safeListing = toSerializableObject(listing);
    if (!safeListing) {
      console.log(`[GET /listings/:id] Listing is not serializable`);
      return c.json({ error: "Listing not found" }, 404);
    }

    if (isListingExpired(safeListing)) {
      console.log(`[GET /listings/:id] Listing is expired`);
      try {
        await deleteListingRecords(safeListing);
      } catch (cleanupError) {
        console.error(`[GET /listings/:id] Expired listing cleanup failed:`, cleanupError);
      }
      return c.json({ error: "Listing not found" }, 404);
    }

    // Seller lookup should not fail the whole listing response.
    let seller = null;
    if (safeListing.sellerId) {
      try {
        seller = await kv.get(`user:${safeListing.sellerId}`);
      } catch (sellerError) {
        console.error("Get listing seller error:", sellerError);
      }
    }

    const safeSeller = toSerializableObject(seller);
    const response = { listing: { ...safeListing, seller: safeSeller } };
    console.log(`[GET /listings/:id] Returning response, listing has keys:`, Object.keys(safeListing || {}).join(','));
    return c.json(response);
  } catch (error) {
    console.error("Get listing error:", error);
    return c.json({ error: "Failed to get listing" }, 500);
  }
});

app.delete("/make-server-dd877831/listings/:id", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const id = c.req.param('id');
    const listing = await kv.get(`listing:${id}`);

    if (!listing || typeof listing !== 'object') {
      return c.json({ error: "Listing not found" }, 404);
    }

    const role = await getUserRole(user.id);
    if (listing.sellerId !== user.id && role !== 'admin') {
      return c.json({ error: "Only the seller can delete this listing" }, 403);
    }

    await deleteListingRecords(listing);
    return c.json({ success: true });
  } catch (error) {
    console.error("Delete listing error:", error);
    return c.json({ error: "Failed to delete listing" }, 500);
  }
});

app.get("/make-server-dd877831/listings/user/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    console.log(`[GET /listings/user/:userId] Fetching listings for userId: ${userId}`);
    
    let rawListings;
    try {
      rawListings = await kv.getByPrefix(`listing:user:${userId}:`);
      console.log(`[GET /listings/user/:userId] KV.getByPrefix returned:`, Array.isArray(rawListings) ? `array with ${rawListings.length} items` : "non-array");
    } catch (kvError) {
      console.error(`[GET /listings/user/:userId] KV.getByPrefix failed:`, kvError);
      return c.json({ error: "Failed to fetch listings from store" }, 500);
    }
    
    const safeListings = Array.isArray(rawListings)
      ? rawListings.filter((l: any) => l && typeof l === 'object')
      : [];

    console.log(`[GET /listings/user/:userId] After filtering: ${safeListings.length} safe listings`);

    const visibleListings: any[] = [];
    for (const listing of safeListings) {
      if (isListingExpired(listing)) {
        await deleteListingRecords(listing);
        continue;
      }
      visibleListings.push(listing);
    }

    console.log(`[GET /listings/user/:userId] After expiration check: ${visibleListings.length} visible listings`);
    visibleListings.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    return c.json({ listings: visibleListings });
  } catch (error) {
    console.error("Get user listings error:", error);
    return c.json({ error: "Failed to get user listings" }, 500);
  }
});

// ===== OFFER ROUTES =====

app.post("/make-server-dd877831/offers", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { listingId, offeredProduce, message } = await c.req.json();

    if (!offeredProduce) {
      return c.json({ error: "You must specify what you're offering" }, 400);
    }

    const listing = await kv.get(`listing:${listingId}`);
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    if (listing.sellerId === user.id) {
      return c.json({ error: "You cannot make an offer on your own listing" }, 400);
    }

    // Check for duplicate offer: same listing + buyer + offered_produce
    const buyerOffers = await kv.getByPrefix(`offer:buyer:${user.id}:`);
    const duplicate = buyerOffers.find((offer: any) =>
      offer.listingId === listingId &&
      offer.offeredProduce === offeredProduce &&
      offer.status !== 'declined' // Allow re-offering after declining
    );
    if (duplicate) {
      return c.json({ error: "You already have an offer for this produce on this listing. Delete your existing offer to submit a new one." }, 400);
    }

    const offerId = crypto.randomUUID();
    const offer = {
      id: offerId,
      listingId,
      buyerId: user.id,
      sellerId: listing.sellerId,
      offeredProduce,
      message: message || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await kv.set(`offer:${offerId}`, offer);
    await kv.set(`offer:listing:${listingId}:${offerId}`, offer);
    await kv.set(`offer:buyer:${user.id}:${offerId}`, offer);
    await kv.set(`offer:seller:${listing.sellerId}:${offerId}`, offer);

    return c.json({ success: true, offer });
  } catch (error) {
    console.error("Create offer error:", error);
    return c.json({ error: "Failed to create offer" }, 500);
  }
});

app.post("/make-server-dd877831/offers/:id/accept", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const offerId = c.req.param('id');
    const offer = await kv.get(`offer:${offerId}`);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id) {
      return c.json({ error: "Only the seller can accept offers" }, 403);
    }

    offer.status = 'accepted';
    offer.acceptedAt = new Date().toISOString();

    await kv.set(`offer:${offerId}`, offer);
    await kv.set(`offer:listing:${offer.listingId}:${offerId}`, offer);
    await kv.set(`offer:buyer:${offer.buyerId}:${offerId}`, offer);
    await kv.set(`offer:seller:${offer.sellerId}:${offerId}`, offer);

    return c.json({ success: true, offer });
  } catch (error) {
    console.error("Accept offer error:", error);
    return c.json({ error: "Failed to accept offer" }, 500);
  }
});

app.post("/make-server-dd877831/offers/:id/decline", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const offerId = c.req.param('id');
    const offer = await kv.get(`offer:${offerId}`);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id) {
      return c.json({ error: "Only the seller can decline offers" }, 403);
    }

    offer.status = 'declined';
    offer.declinedAt = new Date().toISOString();

    await kv.set(`offer:${offerId}`, offer);
    await kv.set(`offer:listing:${offer.listingId}:${offerId}`, offer);
    await kv.set(`offer:buyer:${offer.buyerId}:${offerId}`, offer);
    await kv.set(`offer:seller:${offer.sellerId}:${offerId}`, offer);

    return c.json({ success: true, offer });
  } catch (error) {
    console.error("Decline offer error:", error);
    return c.json({ error: "Failed to decline offer" }, 500);
  }
});

app.post("/make-server-dd877831/offers/:id/complete", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const offerId = c.req.param('id');
    const offer = await kv.get(`offer:${offerId}`);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id && offer.buyerId !== user.id) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    if (offer.status !== 'accepted') {
      return c.json({ error: "Only accepted offers can be completed" }, 400);
    }

    offer.status = 'completed';
    offer.completedAt = new Date().toISOString();

    await kv.set(`offer:${offerId}`, offer);
    await kv.set(`offer:listing:${offer.listingId}:${offerId}`, offer);
    await kv.set(`offer:buyer:${offer.buyerId}:${offerId}`, offer);
    await kv.set(`offer:seller:${offer.sellerId}:${offerId}`, offer);

    // Swap listing ownership: buyer becomes the new seller
    const listing = await kv.get(`listing:${offer.listingId}`);
    if (listing) {
      const oldSellerId = listing.sellerId;
      const newSellerId = offer.buyerId;

      listing.status = 'completed';
      listing.sellerId = newSellerId;

      // Update listing in all KV indexes
      await kv.set(`listing:${offer.listingId}`, listing);
      await kv.set(`listing:community:${listing.communityId}:${offer.listingId}`, listing);

      // Remove old seller index and add new seller index
      await kv.del(`listing:user:${oldSellerId}:${offer.listingId}`);
      await kv.set(`listing:user:${newSellerId}:${offer.listingId}`, listing);

      // Mirror the status/owner change into the secondary index. Now 'completed',
      // it drops out of the active feed automatically.
      await listingsIndex.upsertListing(listing);
    }

    return c.json({ success: true, offer });
  } catch (error) {
    console.error("Complete offer error:", error);
    return c.json({ error: "Failed to complete offer" }, 500);
  }
});

app.delete("/make-server-dd877831/offers/:id", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const offerId = c.req.param('id');
    const offer = await kv.get(`offer:${offerId}`);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.buyerId !== user.id) {
      return c.json({ error: "Only the buyer can delete their offer" }, 403);
    }

    // Delete from all KV store keys
    await kv.del(`offer:${offerId}`);
    await kv.del(`offer:listing:${offer.listingId}:${offerId}`);
    await kv.del(`offer:buyer:${offer.buyerId}:${offerId}`);
    await kv.del(`offer:seller:${offer.sellerId}:${offerId}`);

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete offer error:", error);
    return c.json({ error: "Failed to delete offer" }, 500);
  }
});

app.get("/make-server-dd877831/offers/my", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const asType = c.req.query('as'); // 'buyer' or 'seller'

    let offers = [];
    if (asType === 'buyer') {
      offers = await kv.getByPrefix(`offer:buyer:${user.id}:`);
    } else if (asType === 'seller') {
      offers = await kv.getByPrefix(`offer:seller:${user.id}:`);
    } else {
      const buyerOffers = await kv.getByPrefix(`offer:buyer:${user.id}:`);
      const sellerOffers = await kv.getByPrefix(`offer:seller:${user.id}:`);
      offers = [...buyerOffers, ...sellerOffers];
    }

    offers.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ offers });
  } catch (error) {
    console.error("Get my offers error:", error);
    return c.json({ error: "Failed to get offers" }, 500);
  }
});

// ===== TRENDING ROUTES =====

app.get("/make-server-dd877831/trending/zip/:zipCode", async (c) => {
  try {
    const zipCode = c.req.param('zipCode');

    // Get all active listings in this zip code
    const allListings = await kv.getByPrefix('listing:community:');
    const zipListings = allListings.filter(
      (l: any) => l && typeof l === 'object' && l.zipCode === zipCode && l.status === 'active' && !isListingExpired(l)
    );

    // Count offers per listing in parallel
    const withCounts = await Promise.all(
      zipListings.map(async (listing: any) => {
        const offers = await kv.getByPrefix(`offer:listing:${listing.id}:`);
        return { listing, offerCount: Array.isArray(offers) ? offers.length : 0 };
      })
    );

    // Sort by offer count descending, return top 5
    withCounts.sort((a: any, b: any) => b.offerCount - a.offerCount);
    const items = withCounts.slice(0, 5);

    return c.json({ items });
  } catch (error) {
    console.error("Trending by zip error:", error);
    return c.json({ error: "Failed to get trending items" }, 500);
  }
});

app.get("/make-server-dd877831/trending/community/:communityId", async (c) => {
  try {
    const communityId = c.req.param('communityId');
    const rawListings = await kv.getByPrefix(`listing:community:${communityId}:`);
    const communityListings = Array.isArray(rawListings)
      ? rawListings.filter(
          (l: any) => l && typeof l === 'object' && l.status === 'active' && !isListingExpired(l)
        )
      : [];

    const withCounts = await Promise.all(
      communityListings.map(async (listing: any) => {
        const offers = await kv.getByPrefix(`offer:listing:${listing.id}:`);
        return { listing, offerCount: Array.isArray(offers) ? offers.length : 0 };
      })
    );

    withCounts.sort((a: any, b: any) => {
      if (b.offerCount !== a.offerCount) return b.offerCount - a.offerCount;
      return new Date(b.listing.createdAt || 0).getTime() - new Date(a.listing.createdAt || 0).getTime();
    });

    return c.json({ items: withCounts });
  } catch (error) {
    console.error("Trending by community error:", error);
    return c.json({ error: "Failed to get community rankings" }, 500);
  }
});

// ===== CHAT ROUTES =====

app.post("/make-server-dd877831/chat/support", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    // Return existing support thread if one already exists for this user
    const existingThreads = await kv.getByPrefix(`thread:user:${user.id}:`);
    const existing = existingThreads.find((t: any) => t?.type === 'support');
    if (existing) {
      return c.json({ thread: existing });
    }

    // Find all admin users using dedicated admin index (efficient prefix scan)
    const adminIndices = await kv.getByPrefix('role:admin:');
    const admins = (adminIndices ?? [])
      .map((entry: any) => entry.userId)
      .filter((id: string) => id && id !== user.id);

    if (admins.length === 0) {
      return c.json({ error: "No admins available" }, 404);
    }

    const threadId = crypto.randomUUID();
    const participants = [user.id, ...admins];

    const thread = {
      id: threadId,
      listingId: 'support',
      type: 'support',
      title: 'Support Team',
      participants,
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await kv.set(`thread:${threadId}`, thread);
    for (const pid of participants) {
      await kv.set(`thread:user:${pid}:${threadId}`, thread);
    }

    return c.json({ thread });
  } catch (error) {
    console.error("Create support thread error:", error);
    return c.json({ error: "Failed to create support thread" }, 500);
  }
});

app.post("/make-server-dd877831/chat/threads", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { listingId, otherUserId } = await c.req.json();

    // Check if thread already exists
    const threadId = [user.id, otherUserId].sort().join(':');
    const existingThread = await kv.get(`thread:${threadId}:${listingId}`);

    if (existingThread) {
      return c.json({ thread: existingThread });
    }

    const thread = {
      id: `${threadId}:${listingId}`,
      listingId,
      participants: [user.id, otherUserId],
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await kv.set(`thread:${threadId}:${listingId}`, thread);
    await kv.set(`thread:user:${user.id}:${thread.id}`, thread);
    await kv.set(`thread:user:${otherUserId}:${thread.id}`, thread);

    return c.json({ thread });
  } catch (error) {
    console.error("Create thread error:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

app.post("/make-server-dd877831/chat/messages", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { threadId, content } = await c.req.json();

    const thread = await kv.get(`thread:${threadId}`);
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    if (!thread.participants.includes(user.id)) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const messageId = crypto.randomUUID();
    const message = {
      id: messageId,
      threadId,
      senderId: user.id,
      content,
      createdAt: new Date().toISOString(),
    };

    await kv.set(`message:${messageId}`, message);
    await kv.set(`message:thread:${threadId}:${messageId}`, message);

    // Update thread
    thread.lastMessage = content;
    thread.lastMessageAt = message.createdAt;
    await kv.set(`thread:${threadId}`, thread);

    // Update for both participants
    for (const participantId of thread.participants) {
      await kv.set(`thread:user:${participantId}:${thread.id}`, thread);
    }

    return c.json({ success: true, message });
  } catch (error) {
    console.error("Send message error:", error);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

app.get("/make-server-dd877831/chat/threads", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const threads = await kv.getByPrefix(`thread:user:${user.id}:`);
    threads.sort((a: any, b: any) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    return c.json({ threads });
  } catch (error) {
    console.error("Get threads error:", error);
    return c.json({ error: "Failed to get threads" }, 500);
  }
});

app.get("/make-server-dd877831/chat/messages/:threadId", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const threadId = c.req.param('threadId');
    const thread = await kv.get(`thread:${threadId}`);

    if (!thread || !thread.participants.includes(user.id)) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const messages = await kv.getByPrefix(`message:thread:${threadId}:`);
    messages.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return c.json({ messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return c.json({ error: "Failed to get messages" }, 500);
  }
});

app.delete("/make-server-dd877831/chat/messages/:messageId", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const messageId = c.req.param('messageId');
    const message = await kv.get(`message:${messageId}`);

    if (!message || typeof message !== 'object') {
      return c.json({ error: "Message not found" }, 404);
    }

    const role = await getUserRole(user.id);
    if (message.senderId !== user.id && role !== 'admin') {
      return c.json({ error: "Forbidden" }, 403);
    }

    await kv.del(`message:${messageId}`);
    await kv.del(`message:thread:${message.threadId}:${messageId}`);

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete message error:", error);
    return c.json({ error: "Failed to delete message" }, 500);
  }
});

// ===== RATING ROUTES =====

app.post("/make-server-dd877831/ratings", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { offerId, rating, comment } = await c.req.json();

    if (rating < 1 || rating > 5) {
      return c.json({ error: "Rating must be between 1 and 5" }, 400);
    }

    const offer = await kv.get(`offer:${offerId}`);
    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.status !== 'completed') {
      return c.json({ error: "Can only rate completed exchanges" }, 400);
    }

    // Determine who is being rated
    const ratedUserId = offer.sellerId === user.id ? offer.buyerId : offer.sellerId;

    // Check if already rated
    const existingRating = await kv.get(`rating:${offerId}:${user.id}`);
    if (existingRating) {
      return c.json({ error: "You have already rated this exchange" }, 400);
    }

    // Snapshot listing details so they're preserved even if the listing is later deleted
    const listing = await kv.get(`listing:${offer.listingId}`);
    const listingSnapshot = listing
      ? { id: listing.id, title: listing.title, photoUrl: listing.photos?.[0] ?? null }
      : null;

    const ratingId = crypto.randomUUID();
    const newRating = {
      id: ratingId,
      offerId,
      ratedUserId,
      raterUserId: user.id,
      rating,
      comment: comment || '',
      listingSnapshot,
      createdAt: new Date().toISOString(),
    };

    await kv.set(`rating:${ratingId}`, newRating);
    await kv.set(`rating:${offerId}:${user.id}`, newRating);
    await kv.set(`rating:user:${ratedUserId}:${ratingId}`, newRating);

    // Update user's rating
    const ratedUser = await kv.get(`user:${ratedUserId}`);
    if (ratedUser) {
      const currentTotal = (ratedUser.rating || 0) * (ratedUser.ratingCount || 0);
      const newCount = (ratedUser.ratingCount || 0) + 1;
      const newAverage = (currentTotal + rating) / newCount;

      ratedUser.rating = Math.round(newAverage * 10) / 10; // Round to 1 decimal
      ratedUser.ratingCount = newCount;

      await kv.set(`user:${ratedUserId}`, ratedUser);
    }

    return c.json({ success: true, rating: newRating });
  } catch (error) {
    console.error("Create rating error:", error);
    return c.json({ error: "Failed to create rating" }, 500);
  }
});

app.get("/make-server-dd877831/ratings/user/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const ratings = await kv.getByPrefix(`rating:user:${userId}:`);

    ratings.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ ratings });
  } catch (error) {
    console.error("Get user ratings error:", error);
    return c.json({ error: "Failed to get ratings" }, 500);
  }
});

app.delete("/make-server-dd877831/ratings/:ratingId", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const ratingId = c.req.param('ratingId');
    const rating = await kv.get(`rating:${ratingId}`);

    if (!rating || typeof rating !== 'object') {
      return c.json({ error: "Rating not found" }, 404);
    }

    const role = await getUserRole(user.id);
    if (rating.raterUserId !== user.id && role !== 'admin') {
      return c.json({ error: "Forbidden" }, 403);
    }

    await kv.del(`rating:${ratingId}`);
    await kv.del(`rating:${rating.offerId}:${rating.raterUserId}`);
    await kv.del(`rating:user:${rating.ratedUserId}:${ratingId}`);

    // Recompute aggregate rating for the rated user
    const remainingRatings = await kv.getByPrefix(`rating:user:${rating.ratedUserId}:`);
    const ratedUser = await kv.get(`user:${rating.ratedUserId}`);
    if (ratedUser) {
      const count = remainingRatings.length;
      const avg = count > 0
        ? remainingRatings.reduce((sum: number, r: any) => sum + (r.rating ?? 0), 0) / count
        : 0;
      ratedUser.rating = Math.round(avg * 10) / 10;
      ratedUser.ratingCount = count;
      await kv.set(`user:${rating.ratedUserId}`, ratedUser);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Delete rating error:", error);
    return c.json({ error: "Failed to delete rating" }, 500);
  }
});

// ===== PROFILE ROUTES =====

app.put("/make-server-dd877831/profile", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const updates = await c.req.json();
    const profile = await kv.get(`user:${user.id}`);

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    // Update allowed fields
    if (updates.name !== undefined) profile.name = updates.name;
    if (updates.bio !== undefined) profile.bio = updates.bio;
    if (updates.socialUrl !== undefined) profile.socialUrl = updates.socialUrl;
    if (updates.profilePhotoUrl !== undefined) profile.profilePhotoUrl = updates.profilePhotoUrl;

    await kv.set(`user:${user.id}`, profile);

    return c.json({ success: true, profile });
  } catch (error) {
    console.error("Update profile error:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }
});

app.get("/make-server-dd877831/profile/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const profile = await kv.get(`user:${userId}`);

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    return c.json({ profile });
  } catch (error) {
    console.error("Get profile error:", error);
    return c.json({ error: "Failed to get profile" }, 500);
  }
});

// ===== STORAGE ROUTES =====

app.post("/make-server-dd877831/upload", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    const supabase = getServiceRoleClient();
    const bucketName = STORAGE_BUCKET_NAME;
    const fileName = `${user.id}/${crypto.randomUUID()}-${file.name}`;

    const fileBuffer = await file.arrayBuffer();
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: file.type,
        upsert: false
      });

    if (error) {
      console.error("Upload error:", error);
      return c.json({ error: "Upload failed" }, 500);
    }

    // Generate signed URL (valid for 1 year)
    const { data: urlData } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(fileName, 31536000);

    return c.json({ success: true, url: urlData?.signedUrl, path: fileName });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// ── AI listing-description assistant (Claude, with prompt caching) ──────────
//
// The system prompt below is large and *stable* — the same bytes on every
// request — so it's the ideal cached prefix. We mark its last (only) block with
// cache_control: {type: "ephemeral"}; the volatile per-request input (the user's
// title/notes) goes in the messages array, after the breakpoint, so it never
// invalidates the cache. Render order is tools → system → messages, so the
// breakpoint on the system block caches the whole prefix.
//
// Caching is a prefix match with a model-dependent minimum: on claude-opus-4-8
// the prefix must exceed ~4096 tokens before anything is written to cache
// (shorter prefixes silently don't cache — usage.cache_creation_input_tokens
// stays 0). The guide below is intentionally substantial so repeat calls within
// the 5-minute TTL read from cache (~0.1x input cost) instead of reprocessing.
const LISTING_ASSISTANT_SYSTEM = `You are the listing assistant for Share Crops, a neighborhood produce-bartering community where people trade homegrown fruit, vegetables, eggs, honey, flowers, and baked goods — no money changes hands.

Your job: turn a grower's rough title and optional notes into ONE warm, concrete listing description that helps a neighbor decide whether to make an offer.

OUTPUT CONTRACT
- Return only the description text. No preamble ("Here is…"), no headings, no markdown, no quotation marks, no sign-off.
- 1 to 3 sentences, 200 characters or fewer.
- Plain, friendly, first-person voice ("Picked this morning…", "Happy to trade for…").
- Never invent specifics the grower didn't imply: do not fabricate weight, price, pesticide claims, certifications, or pickup logistics.
- No prices or money — this is a barter community.
- If the input is empty or nonsensical, return a single short neutral sentence inviting an offer.

STYLE GUIDE
- Lead with what makes the item appealing: freshness, flavor, variety, abundance ("garden is overflowing").
- Be specific where the grower gave you something to work with (variety name, how it was grown, when it was picked).
- Prefer sensory, concrete words ("sweet, low-acid", "snappy", "still warm") over vague praise ("amazing", "the best").
- It's fine to mention a trade interest if the notes suggest one ("would love herbs in return").
- Keep it honest and modest — neighbors value trustworthiness over hype.

SEASONAL REFERENCE (use only to inform tone/季 phrasing; do not assert a season the grower didn't):
- Spring: asparagus, peas, radishes, lettuces, strawberries, rhubarb, green garlic, chives, spring onions.
- Summer: tomatoes (heirloom, cherry, paste), zucchini & summer squash, cucumbers, peppers (sweet & chili), green beans, corn, basil, eggplant, melons, blackberries, raspberries, peaches, plums, figs.
- Autumn: winter squash (butternut, delicata, kabocha), pumpkins, apples, pears, grapes, kale, chard, beets, carrots, leeks, cabbage, fennel.
- Winter: citrus (Meyer lemons, mandarins), persimmons, pomegranates, hardy greens, storage potatoes & onions, dried beans, preserves.
- Year-round (anytime): eggs, raw honey, herbs, microgreens, sourdough & baked goods, cut flowers, seedlings & starts.

EXAMPLES
Title: "Heirloom tomatoes" / Notes: "picked today, want basil"
→ Heirloom tomatoes picked this morning — sweet and low-acid, perfect for slicing. Would happily trade for a bunch of fresh basil.

Title: "Too many zucchini" / Notes: ""
→ The garden is overflowing with zucchini — crisp, tender, and cut to order. Take some off my hands!

Title: "eggs" / Notes: "mixed, blue and brown"
→ A dozen mixed brown and blue eggs from our backyard hens, gathered this week.`;

let _anthropic: Anthropic | null = null;
const getAnthropic = (): Anthropic | null => {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey });
  return _anthropic;
};

app.post("/make-server-dd877831/listings/draft-description", async (c) => {
  const user = await getAuthUser(c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const anthropic = getAnthropic();
  if (!anthropic) {
    return c.json({ error: "AI assistant is not configured" }, 503);
  }

  try {
    const { title, notes } = await c.req.json();

    const titleValidation = security.validateInput(title, "string", { minLength: 1, maxLength: 200 });
    if (!titleValidation.valid) {
      return c.json({ error: "Title must be 1-200 characters" }, 400);
    }
    const notesValidation = security.validateInput(notes || "", "string", { maxLength: 500 });
    if (!notesValidation.valid) {
      return c.json({ error: "Notes must be 0-500 characters" }, 400);
    }

    const response = await anthropic.messages.create({
      // Haiku 4.5 — this is a short, tightly-constrained ≤200-char text task;
      // Opus-tier is overkill. ~5x cheaper than Opus 4.8 at equal quality here.
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      // cache_control marks the stable system prefix, but it is a no-op at this
      // size: the prompt is ~475 tokens and the min cacheable prefix is 4096
      // tokens (Haiku 4.5 / Opus). Kept so caching kicks in automatically if the
      // system prompt ever grows past the threshold; harmless until then.
      system: [
        { type: "text", text: LISTING_ASSISTANT_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      // Volatile per-request input lives here, after the cached prefix.
      messages: [
        {
          role: "user",
          content: `Title: ${title}\nNotes: ${notes || "(none)"}\n\nWrite the listing description.`,
        },
      ],
    });

    const description = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();

    return c.json({
      description,
      // Surfaced so the caller can confirm caching is working: cacheRead > 0 on
      // repeat calls within the TTL means the system prefix was served from cache.
      usage: {
        inputTokens: response.usage.input_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error("draft-description error:", error);
    return c.json({ error: "Could not generate a description" }, 500);
  }
});

export { app };
