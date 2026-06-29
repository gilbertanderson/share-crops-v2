// @ts-nocheck
// Node backend for the Share Crops API. Vercel runs this today; the module is
// intentionally portable to any Node host/container.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import * as db from "./db.ts";
import * as fcm from "./fcm.ts";
import * as security from "./security.ts";
import * as storage from "./storage.ts";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "./env.ts";
import { verifyFirebaseToken, getFirebaseProjectId } from "./firebaseAdmin.ts";

const ADMIN_EMAIL = (() => {
  const adminEmail = getEnv('ADMIN_EMAIL');
  if (!adminEmail || adminEmail.trim() === '') {
    throw new Error('ADMIN_EMAIL environment variable is required for admin role assignment');
  }
  return adminEmail.toLowerCase();
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
// localhost on any port (local dev), OR it's any Vercel preview/production URL.
// Returning the origin string tells Hono to echo it in Access-Control-Allow-Origin.
const isAllowedOrigin = (origin: string | undefined | null): string | null => {
  if (!origin) return null;
  if (CORS_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)) return origin;
  return null;
};

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

// Initialize on startup
if (getEnv("SKIP_INIT") !== "true") {
  initStorage();
}

// Helper: Get authenticated user
const getAuthUser = async (authHeader: string | null) => {
  if (!authHeader) {
    security.logSecurityEvent('missing_auth_header', 'medium', { timestamp: new Date().toISOString() });
    return null;
  }

  // Validate the Authorization header shape: `Bearer <token>`.
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    security.logSecurityEvent('invalid_auth_format', 'medium', {
      format: parts[0],
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  const token = parts[1];

  // Cheap structural JWT check before the (network-bound) signature verify.
  const tokenValidation = security.validateJwtStructure(token);
  if (!tokenValidation.valid) {
    security.logSecurityEvent('invalid_token_structure', 'high', {
      error: tokenValidation.error,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  try {
    const user = await verifyFirebaseToken(token);

    if (!user) {
      security.logSecurityEvent('auth_error', 'high', { timestamp: new Date().toISOString() });
      return null;
    }

    // Routes key everything off id + email, so both are required.
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
    return null;
  }
};

const normalizeUserRole = (role: unknown): 'admin' | 'general' => {
  return role === 'admin' || role === 'general' ? role : 'general';
};

const getUserRole = async (userId: string): Promise<'admin' | 'general'> => {
  const profile = await db.getProfile(userId);
  return normalizeUserRole(profile?.role);
};

const MAX_LISTING_EXPIRATION_DAYS = 30;

// When a user loses their active community (left / removed / cleared), fall back
// to any remaining membership, else clear it. memberCount is a view now, so
// there's nothing to recount — leaving/joining is a single membership row.
const reassignActiveCommunity = async (userId: string, removedCommunityId: string) => {
  const activeCommunityId = await db.getActiveCommunityId(userId);
  if (activeCommunityId !== removedCommunityId) return;
  const remaining = await db.getMembershipCommunityIds(userId);
  await db.setActiveCommunityId(userId, remaining[0] ?? null);
};

const isListingExpired = (listing: any): boolean => {
  if (!listing?.expiresAt) return false;
  const expiresAt = new Date(listing.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt;
};

const deleteListingRecords = async (listing: any) => {
  if (!listing?.id) return;
  // One row now (offers cascade via FK), instead of 3 hand-synced KV copies +
  // the secondary index.
  await db.deleteListing(listing.id);
};

// Health check endpoint
app.get(`/${API_PREFIX}/health`, (c) => {
  return c.json({ status: "ok", firebaseProjectId: getFirebaseProjectId() });
});

// ===== AUTH ROUTES =====

// Signup, login, and password reset are handled entirely by Firebase Auth in
// the browser (see src/lib/firebaseAuth.ts). The legacy Supabase-backed
// /auth/signup, /auth/login, and /auth/reset-password endpoints were removed:
// they created a parallel Supabase identity with the service role and issued
// Supabase access tokens that this API (which verifies Firebase ID tokens)
// cannot consume — dead but exploitable surface for credential stuffing and
// user enumeration. The only auth endpoint the app uses is GET /auth/me below.

app.get("/make-server-dd877831/auth/me", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    let profile = await db.getProfile(user.id);

    // Auto-provision a profile for users created outside the email/password
    // signup flow (e.g. Google OAuth), who have a valid Supabase identity but no
    // app profile yet. Mirrors the shape written by /auth/signup.
    if (!profile) {
      const meta = user.user_metadata || {};
      const rawName = meta.full_name || meta.name || user.email.split('@')[0];
      profile = await db.upsertProfile({
        id: user.id,
        email: security.sanitizeString(user.email),
        name: security.sanitizeString(String(rawName)),
        bio: '',
        socialUrl: '',
        profilePhotoUrl: meta.avatar_url || meta.picture || '',
        role: user.email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'general',
      });
      security.logSecurityEvent('oauth_user_provisioned', 'low', { userId: user.id });
    } else if (
      user.email.toLowerCase() === ADMIN_EMAIL &&
      normalizeUserRole(profile.role) !== 'admin'
    ) {
      profile = await db.updateProfile(user.id, { role: 'admin' });
    }

    return c.json({ user: profile });
  } catch (error) {
    console.error("Auth me error:", error);
    return c.json({ error: "Failed to load profile" }, 500);
  }
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

    // Dedup is enforced by communities_zip_lname_uidx (zip + lower(name)).
    let community;
    try {
      community = await db.createCommunity({ name, zipCode: zipCode.trim(), createdBy: user.id });
    } catch (e) {
      if (e instanceof db.DuplicateCommunityError) {
        return c.json({ error: "A community with this name already exists in this zip code", duplicate: true }, 409);
      }
      throw e;
    }

    // Creator joins and makes it active. (The KV version forgot to add the
    // creator to the member index — fixed here.)
    await db.addMembership(user.id, community.id);
    await db.setActiveCommunityId(user.id, community.id);

    return c.json({ success: true, community: { ...community, memberCount: 1 } });
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

    const community = await db.getCommunity(communityId);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const alreadyMember = await db.isMember(user.id, communityId);

    // addMembership is idempotent; set active either way. memberCount comes
    // from the view, so re-reading reflects the new member with no recount.
    await db.addMembership(user.id, communityId);
    await db.setActiveCommunityId(user.id, communityId);

    if (alreadyMember) {
      return c.json({ success: true, community, alreadyMember: true });
    }

    const updatedCommunity = await db.getCommunity(communityId);
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

    const communities = await db.searchCommunitiesByZip(zipCode.trim());
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
    let communityId = await db.getActiveCommunityId(user.id);

    if (!communityId) {
      const communityIds = await db.getMembershipCommunityIds(user.id);
      if (communityIds.length > 0) {
        communityId = communityIds[0];
        await db.setActiveCommunityId(user.id, communityId);
      }
    }

    if (!communityId) {
      return c.json({ community: null });
    }

    const community = await db.getCommunity(communityId);

    if (!community) {
      await db.setActiveCommunityId(user.id, null);
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
    const communities = await db.getMemberCommunities(user.id);
    const activeCommunityId = await db.getActiveCommunityId(user.id);
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

    const membership = await db.isMember(user.id, communityId);
    if (!membership) {
      return c.json({ error: "You are not a member of this community" }, 403);
    }

    const community = await db.getCommunity(communityId);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    await db.setActiveCommunityId(user.id, communityId);
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

    if (!(await db.isMember(user.id, communityId))) {
      return c.json({ error: "You are not a member of this community" }, 404);
    }

    // One row deleted; memberCount drops automatically (it's a view).
    await db.removeMembership(user.id, communityId);
    await reassignActiveCommunity(user.id, communityId);

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

    // Up to 12 members, profiles joined in one round trip.
    const full = await db.listCommunityMembers(communityId, 12);
    const members = full.map((m: any) => ({ id: m.id, name: m.name, profilePhotoUrl: m.profilePhotoUrl ?? null }));

    return c.json({ members });
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
    const members = await db.listCommunityMembers(communityId);
    return c.json({ members });
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

    if (!(await db.isMember(targetUserId, communityId))) {
      return c.json({ error: "User is not a member of this community" }, 404);
    }

    await db.removeMembership(targetUserId, communityId);
    await reassignActiveCommunity(targetUserId, communityId);

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
    const communities = await db.getAllCommunities();
    return c.json({ communities });
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

    // One delete clears the roster and returns the affected users; reassign the
    // active community for any who had this one selected.
    const removedUserIds = await db.clearCommunityMembers(communityId);
    for (const userId of removedUserIds) {
      await reassignActiveCommunity(userId, communityId);
    }

    return c.json({ success: true, removed: removedUserIds.length });
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

    // Validate expiration (admins may pass 0 for a non-expiring listing — testing)
    let expiresAt: string | null;
    if (Number(expiresInDays) === 0) {
      const role = await getUserRole(user.id);
      if (role !== 'admin') {
        return c.json({ error: `Expiration must be an integer between 1 and ${MAX_LISTING_EXPIRATION_DAYS} days` }, 400);
      }
      expiresAt = null;
    } else {
      const parsedExpiration = Number(expiresInDays ?? 30);
      if (!Number.isInteger(parsedExpiration) || parsedExpiration < 1 || parsedExpiration > MAX_LISTING_EXPIRATION_DAYS) {
        return c.json({ error: `Expiration must be an integer between 1 and ${MAX_LISTING_EXPIRATION_DAYS} days` }, 400);
      }
      expiresAt = new Date(Date.now() + parsedExpiration * 24 * 60 * 60 * 1000).toISOString();
    }

    // Prevent SQL injection in text fields
    const sqlSafety = security.validateQuerySafety(title + description + quantity);
    if (!sqlSafety.safe) {
      security.logSecurityEvent('sql_injection_in_listing', 'high', { userId: user.id });
      return c.json({ error: "Invalid characters detected in input" }, 400);
    }

    const communityId = await db.getActiveCommunityId(user.id);
    if (!communityId) {
      return c.json({ error: "You must join a community first" }, 400);
    }

    const community = await db.getCommunity(communityId);
    if (!community) {
      return c.json({ error: "You must join a community first" }, 400);
    }

    // Guard against a stale active_community_id (e.g. after being removed from a
    // community) letting a user post into a community they no longer belong to.
    const stillMember = await db.isMember(user.id, communityId);
    if (!stillMember) {
      return c.json({ error: "You must join a community first" }, 400);
    }

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
      expiresAt,
    };

    // One INSERT (location is geocoded from zip at backfill time); the feed and
    // "near me" reads come straight off this row's indexes.
    const created = await db.insertListing(listing);

    security.logSecurityEvent('listing_created', 'low', { userId: user.id, listingId });
    return c.json({ success: true, listing: created });
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

    // Indexed, keyset-paginated read off the listings table — active &
    // non-expired, newest-first — instead of scanning every listing:community:
    // key and filtering/sorting in JS.
    const { listings, nextCursor } = await db.queryListingsFeed({
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

// "Near me": active listings within a radius of (lat,lng), nearest-first.
// Net-new capability (PostGIS ST_DWithin); declared before /listings/:id so the
// literal path isn't captured by the :id param.
app.get("/make-server-dd877831/listings/near", async (c) => {
  try {
    const lat = Number(c.req.query('lat'));
    const lng = Number(c.req.query('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: "lat and lng query params are required" }, 400);
    }

    const radiusMilesRaw = Number(c.req.query('radiusMiles'));
    const limit = Number(c.req.query('limit') ?? 50);
    const communityId = c.req.query('communityId');

    const listings = await db.listingsNear({
      lat,
      lng,
      // Let the data layer own the unit conversion and the default radius.
      radiusMiles: Number.isFinite(radiusMilesRaw) ? radiusMilesRaw : undefined,
      communityId: communityId || null,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    return c.json({ listings });
  } catch (error) {
    console.error("Get listings near error:", error);
    return c.json({ error: "Failed to get nearby listings" }, 500);
  }
});

app.get("/make-server-dd877831/listings/:id", async (c) => {
  try {
    const id = c.req.param('id');
    console.log(`[GET /listings/:id] Fetching listing with id: ${id}`);

    if (!id || typeof id !== 'string') {
      return c.json({ error: "Listing not found" }, 404);
    }
    
    // Single indexed primary-key read (the legacy community-index fallback scan
    // is obsolete now that there's one canonical row).
    let listing: any = null;
    try {
      listing = await db.getListing(id);
    } catch (searchError) {
      console.error(`[GET /listings/:id] Listing lookup failed:`, searchError);
      return c.json({ error: "Failed to get listing" }, 500);
    }

    // db.getListing returns a typed DTO or null — no more defending against
    // untyped KV blobs / serializability.
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    if (isListingExpired(listing)) {
      try {
        await deleteListingRecords(listing);
      } catch (cleanupError) {
        console.error(`[GET /listings/:id] Expired listing cleanup failed:`, cleanupError);
      }
      return c.json({ error: "Listing not found" }, 404);
    }

    // Seller lookup should not fail the whole listing response.
    let seller = null;
    if (listing.sellerId) {
      try {
        seller = await db.getProfile(listing.sellerId);
      } catch (sellerError) {
        console.error("Get listing seller error:", sellerError);
      }
    }

    return c.json({ listing: { ...listing, seller } });
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
    const listing = await db.getListing(id);

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
    
    // Indexed read off listings(seller_id), already active/non-expired and
    // newest-first — no prefix scan, no JS filter/sort, no inline expiry cleanup
    // (the query's expires_at predicate hides expired rows).
    let visibleListings: any[] = [];
    try {
      visibleListings = await db.getListingsByUser(userId);
    } catch (dbError) {
      console.error(`[GET /listings/user/:userId] query failed:`, dbError);
      return c.json({ error: "Failed to fetch listings from store" }, 500);
    }

    console.log(`[GET /listings/user/:userId] returning ${visibleListings.length} visible listings`);
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

    const listing = await db.getListing(listingId);
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    if (listing.sellerId === user.id) {
      return c.json({ error: "You cannot make an offer on your own listing" }, 400);
    }

    // Don't allow offers on listings that are no longer open for barter.
    if (listing.status !== 'active' || isListingExpired(listing)) {
      return c.json({ error: "This listing is no longer accepting offers" }, 400);
    }

    const offer = {
      id: crypto.randomUUID(),
      listingId,
      buyerId: user.id,
      sellerId: listing.sellerId,
      offeredProduce,
      message: message || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // The offers_live_dedupe_uidx partial-unique index rejects a second live
    // (listing, buyer, produce) offer race-free — no buyer-offers scan needed.
    let created;
    try {
      created = await db.insertOffer(offer);
    } catch (e) {
      if (e instanceof db.DuplicateOfferError) {
        return c.json({ error: "You already have an offer for this produce on this listing. Delete your existing offer to submit a new one." }, 400);
      }
      throw e;
    }

    // Notify the seller (best-effort; no-ops if push isn't configured).
    await fcm.sendPushToUser(listing.sellerId, {
      title: "New offer on your listing",
      body: `${offer.offeredProduce} for "${listing.title}"`,
      link: `/listing/${listing.id}`,
    });

    return c.json({ success: true, offer: created });
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
    const offer = await db.getOffer(offerId);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id) {
      return c.json({ error: "Only the seller can accept offers" }, 403);
    }

    const updated = await db.setOfferStatus(offerId, 'accepted');
    return c.json({ success: true, offer: updated });
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
    const offer = await db.getOffer(offerId);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id) {
      return c.json({ error: "Only the seller can decline offers" }, 403);
    }

    const updated = await db.setOfferStatus(offerId, 'declined');
    return c.json({ success: true, offer: updated });
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
    const offer = await db.getOffer(offerId);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.sellerId !== user.id && offer.buyerId !== user.id) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    if (offer.status !== 'accepted') {
      return c.json({ error: "Only accepted offers can be completed" }, 400);
    }

    // One transaction: mark the offer completed, mark the listing completed (so
    // it leaves the active feed), and swap ownership to the buyer. The guards
    // above are re-checked under row locks inside complete_offer().
    const completed = await db.completeOffer(offerId, user.id);

    return c.json({ success: true, offer: completed });
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
    const offer = await db.getOffer(offerId);

    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.buyerId !== user.id) {
      return c.json({ error: "Only the buyer can delete their offer" }, 403);
    }

    await db.deleteOffer(offerId);

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
    const as = asType === 'buyer' || asType === 'seller' ? asType : null;

    // Indexed read off offers(buyer_id/seller_id), already newest-first — no
    // prefix scans, no JS merge/sort.
    const offers = await db.getOffersByUser(user.id, as);

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
    const items = await db.getTrending({ zipCode, limit: 5 });
    return c.json({ items });
  } catch (error) {
    console.error("Trending by zip error:", error);
    return c.json({ error: "Failed to get trending items" }, 500);
  }
});

app.get("/make-server-dd877831/trending/community/:communityId", async (c) => {
  try {
    const communityId = c.req.param('communityId');
    const items = await db.getTrending({ communityId });
    return c.json({ items });
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
    // One support thread per user, keyed by dedupe_key.
    const dedupeKey = `support:${user.id}`;
    const existing = await db.getThreadByDedupe(dedupeKey);
    if (existing) {
      return c.json({ thread: existing });
    }

    // Admins are a column now (role = 'admin'), not a KV index.
    const admins = (await db.getAdminUserIds()).filter((id) => id !== user.id);
    if (admins.length === 0) {
      return c.json({ error: "No admins available" }, 404);
    }

    const thread = await db.createThread({
      type: 'support',
      title: 'Support Team',
      dedupeKey,
      participantIds: [user.id, ...admins],
    });

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

    if (!listingId || !otherUserId) {
      return c.json({ error: "listingId and otherUserId are required" }, 400);
    }

    if (otherUserId === user.id) {
      return c.json({ error: "You cannot start a thread with yourself" }, 400);
    }

    // The listing and the other participant must both exist, and the thread has
    // to be anchored to that listing: exactly one of the two participants must
    // be the listing's seller. Without these checks any authenticated user
    // could open DM threads with arbitrary user IDs (and trigger push
    // notifications on them).
    const listing = await db.getListing(listingId);
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const otherProfile = await db.getProfile(otherUserId);
    if (!otherProfile) {
      return c.json({ error: "User not found" }, 404);
    }

    if (listing.sellerId !== user.id && listing.sellerId !== otherUserId) {
      return c.json({ error: "Threads can only be started about a listing with its seller" }, 403);
    }

    // Dedupe on the same composite the KV id encoded: sorted users + listing.
    const dedupeKey = `${[user.id, otherUserId].sort().join(':')}:${listingId}`;
    const existingThread = await db.getThreadByDedupe(dedupeKey);
    if (existingThread) {
      return c.json({ thread: existingThread });
    }

    const thread = await db.createThread({
      listingId,
      type: 'listing',
      dedupeKey,
      participantIds: [user.id, otherUserId],
    });

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

    const thread = await db.getThread(threadId);
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    if (!thread.participants.includes(user.id)) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    // Inserts the message and updates the thread's last_message preview in one
    // place — no per-participant thread copies to fan out.
    const message = await db.insertMessage(threadId, user.id, content);

    // Notify the other thread participants (best-effort; no-ops without push).
    const recipients = thread.participants.filter((id: string) => id !== user.id);
    await Promise.all(recipients.map((id: string) =>
      fcm.sendPushToUser(id, {
        title: thread.title || "New message",
        body: content.length > 140 ? `${content.slice(0, 137)}…` : content,
        link: `/messages/${threadId}`,
      })
    ));

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
    const threads = await db.listThreadsForUser(user.id);
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

    if (!(await db.isThreadParticipant(threadId, user.id))) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    const messages = await db.listMessages(threadId);
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
    const message = await db.getMessage(messageId);

    if (!message) {
      return c.json({ error: "Message not found" }, 404);
    }

    const role = await getUserRole(user.id);
    if (message.senderId !== user.id && role !== 'admin') {
      return c.json({ error: "Forbidden" }, 403);
    }

    await db.deleteMessage(messageId);

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

    const offer = await db.getOffer(offerId);
    if (!offer) {
      return c.json({ error: "Offer not found" }, 404);
    }

    if (offer.status !== 'completed') {
      return c.json({ error: "Can only rate completed exchanges" }, 400);
    }

    // Only the two parties to the exchange may rate it. Without this check any
    // authenticated user could rate an arbitrary completed offer, and a
    // third-party caller would (via the ternary below) be recorded as rating
    // the seller.
    if (user.id !== offer.buyerId && user.id !== offer.sellerId) {
      security.logSecurityEvent('rating_authz_denied', 'high', {
        userId: user.id,
        offerId,
      });
      return c.json({ error: "You can only rate exchanges you were part of" }, 403);
    }

    // Determine who is being rated
    const ratedUserId = offer.sellerId === user.id ? offer.buyerId : offer.sellerId;

    // Snapshot listing details so they're preserved even if the listing is later deleted
    const listing = await db.getListing(offer.listingId);
    const listingSnapshot = listing
      ? { id: listing.id, title: listing.title, photoUrl: listing.photos?.[0] ?? null }
      : null;

    // Dedup (one rating per rater per offer) is enforced by
    // ratings_offer_rater_unique. The rated user's average updates through
    // profiles_view — no counter to maintain.
    let newRating;
    try {
      newRating = await db.insertRating({
        offerId,
        ratedUserId,
        raterUserId: user.id,
        rating,
        comment: comment || '',
        listingSnapshot,
      });
    } catch (e) {
      if (e instanceof db.DuplicateRatingError) {
        return c.json({ error: "You have already rated this exchange" }, 400);
      }
      throw e;
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
    const ratings = await db.getRatingsForUser(userId);
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
    const rating = await db.getRating(ratingId);

    if (!rating) {
      return c.json({ error: "Rating not found" }, 404);
    }

    const role = await getUserRole(user.id);
    if (rating.raterUserId !== user.id && role !== 'admin') {
      return c.json({ error: "Forbidden" }, 403);
    }

    // The rated user's average recomputes via profiles_view on the next read.
    await db.deleteRating(ratingId);

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

    if (!(await db.getProfile(user.id))) {
      return c.json({ error: "Profile not found" }, 404);
    }

    // Only these fields are user-editable; updateProfile emits only the keys
    // that are present.
    const profile = await db.updateProfile(user.id, {
      name: updates.name,
      bio: updates.bio,
      socialUrl: updates.socialUrl,
      profilePhotoUrl: updates.profilePhotoUrl,
    });

    return c.json({ success: true, profile });
  } catch (error) {
    console.error("Update profile error:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }
});

app.get("/make-server-dd877831/profile/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const profile = await db.getProfile(userId);

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

    // Enforce type/size/extension limits and reject path-traversal filenames
    // before touching storage.
    const uploadCheck = security.validateFileUpload(file.name, file.size, file.type);
    if (!uploadCheck.valid) {
      security.logSecurityEvent('invalid_file_upload', 'medium', {
        userId: user.id,
        reason: uploadCheck.error,
        mimeType: file.type,
        size: file.size,
      });
      return c.json({ error: uploadCheck.error || "Invalid file" }, 400);
    }

    const supabase = getServiceRoleClient();
    const bucketName = STORAGE_BUCKET_NAME;
    // Never trust the client-provided name in the storage key: keep only a
    // sanitized extension and generate the rest, scoped under the user's id.
    const rawExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '';
    const key = `${user.id}/${crypto.randomUUID()}${safeExt}`;
    const fileBuffer = await file.arrayBuffer();

    // Preferred: Netlify Blobs — stable same-origin URL (no signed-URL expiry).
    // Falls back to Supabase Storage when Blobs env vars are unset.
    if (storage.isBlobsConfigured()) {
      await storage.putImage(key, fileBuffer, file.type);
      const reqUrl = new URL(c.req.url);
      const servingPath = reqUrl.pathname.replace(/\/upload$/, `/images/${key}`);
      const url = `${reqUrl.origin}${servingPath}`;
      return c.json({ success: true, url, path: key });
    }

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(key, fileBuffer, {
        contentType: file.type,
        upsert: false
      });

    if (error) {
      console.error("Upload error:", error);
      return c.json({ error: "Upload failed" }, 500);
    }

    // Signed URL valid for 1 year. Persisted on listing/profile rows — expires
    // unless refreshed; use Netlify Blobs (above) for stable URLs.
    const { data: urlData } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(key, 31536000);

    return c.json({ success: true, url: urlData?.signedUrl, path: key });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// Serves an image stored in Netlify Blobs by /upload (stable URL path).
app.get("/make-server-dd877831/images/:key{.+}", async (c) => {
  if (!storage.isBlobsConfigured()) {
    return c.json({ error: "Not found" }, 404);
  }
  try {
    const key = c.req.param('key');
    const image = await storage.getImage(key);
    if (!image) {
      return c.json({ error: "Not found" }, 404);
    }
    return new Response(image.data, {
      status: 200,
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error("Image fetch error:", error);
    return c.json({ error: "Failed to load image" }, 500);
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
const DRAFT_MODEL = getEnv("ANTHROPIC_DRAFT_MODEL") || "claude-haiku-4-5-20251001";
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
    return c.json({ error: "AI assistant is not configured — set ANTHROPIC_API_KEY on the server" }, 503);
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
      model: DRAFT_MODEL,
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
  } catch (error: any) {
    console.error("draft-description error:", error);
    const status = typeof error?.status === "number" ? error.status : 500;
    const detail = error?.error?.message || error?.message;
    const message =
      status === 401 || status === 403
        ? "AI assistant authentication failed — check ANTHROPIC_API_KEY"
        : status === 404
          ? `AI model not found (${DRAFT_MODEL}) — check ANTHROPIC_DRAFT_MODEL`
          : typeof detail === "string" && detail.trim()
            ? detail
            : "Could not generate a description";
    return c.json({ error: message }, status >= 400 && status < 600 ? status : 500);
  }
});

// ===== PUSH ROUTES =====

// Register an FCM device token for the authenticated user (web push).
app.post("/make-server-dd877831/push/register", async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { token } = await c.req.json();
    if (!token || typeof token !== 'string') {
      return c.json({ error: "token is required" }, 400);
    }
    await db.savePushToken(user.id, token);
    return c.json({ success: true });
  } catch (error) {
    console.error("Register push token error:", error);
    return c.json({ error: "Failed to register push token" }, 500);
  }
});

export { app };
