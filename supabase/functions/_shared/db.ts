// @ts-nocheck
// Ported Deno backend; type-checked by the Deno runtime, not the Vercel/Node build.
//
// Relational data-access layer (migration B3). Replaces the hand-synced KV blobs
// (`listing:*`, `user:*`, etc.) and the listings_dd877831 mirror with the single
// normalized schema in supabase/migrations/0001_relational_schema.sql.
//
// The Supabase JS client (PostgREST + RPC) is the only driver — it runs in both
// the Deno edge function and the Node/Vercel function, so there's no second DB
// dependency. CRUD goes through `.from(table)`, the two transactional/geo
// operations through `.rpc()`, and the drift-free aggregates through the
// `*_view` views.
//
// Wire shape stays camelCase (what the frontend already consumes); the mappers
// below are the only place snake_case columns are spoken.

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env.ts";

export const db = () => createClient(
  getEnv("SUPABASE_URL")!,
  getEnv("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── mappers: relational row (snake_case) ↔ API DTO (camelCase) ───────────────

export const listingFromRow = (r: any) => (r ? {
  id: r.id,
  sellerId: r.seller_id,
  title: r.title,
  description: r.description ?? "",
  quantity: r.quantity ?? null,
  photos: Array.isArray(r.photos) ? r.photos : [],
  lookingFor: r.looking_for ?? "",
  communityId: r.community_id ?? null,
  zipCode: r.zip_code ?? null,
  status: r.status,
  createdAt: r.created_at,
  expiresAt: r.expires_at ?? null,
} : null);

// Columns the listing-create path writes. location is geocoded separately at
// backfill/create time; omitted here when we don't have coordinates.
export const listingToRow = (l: any) => ({
  id: l.id,
  seller_id: l.sellerId,
  title: l.title,
  description: l.description ?? "",
  quantity: l.quantity ?? null,
  photos: Array.isArray(l.photos) ? l.photos : [],
  looking_for: l.lookingFor ?? "",
  community_id: l.communityId ?? null,
  zip_code: l.zipCode,
  status: l.status ?? "active",
  created_at: l.createdAt ?? new Date().toISOString(),
  expires_at: l.expiresAt ?? null,
});

// profiles_view row (profile + computed rating/rating_count) → DTO.
export const profileFromRow = (r: any) => (r ? {
  id: r.id,
  email: r.email,
  name: r.name ?? "",
  bio: r.bio ?? "",
  socialUrl: r.social_url ?? "",
  profilePhotoUrl: r.profile_photo_url ?? "",
  rating: Number(r.rating ?? 0),
  ratingCount: Number(r.rating_count ?? 0),
  role: r.role ?? "general",
  activeCommunityId: r.active_community_id ?? null,
  createdAt: r.created_at,
} : null);

// ── listings ─────────────────────────────────────────────────────────────────

export const insertListing = async (listing: any) => {
  const { data, error } = await db()
    .from("listings")
    .insert(listingToRow(listing))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return listingFromRow(data);
};

export const getListing = async (id: string) => {
  const { data, error } = await db()
    .from("listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return listingFromRow(data);
};

export const deleteListing = async (id: string) => {
  const { error } = await db().from("listings").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

// A user's own listings, newest-first (active + non-expired).
export const getListingsByUser = async (userId: string) => {
  const { data, error } = await db()
    .from("listings")
    .select("*")
    .eq("seller_id", userId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(listingFromRow);
};

// ── feed: keyset-paginated marketplace listing query ─────────────────────────
// Active, non-expired, newest-first. Scoped to a community when given, else a
// zip, else global. Cursor preserves the previous index-feed wire format.

const encodeCursor = (createdAt: string, id: string) => btoa(`${createdAt}|${id}`);

const decodeCursor = (cursor: string): { createdAt: string; id: string } | null => {
  try {
    const [createdAt, id] = atob(cursor).split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

export const queryListingsFeed = async (opts: {
  communityId?: string | null;
  zipCode?: string | null;
  limit: number;
  cursor?: string | null;
}): Promise<{ listings: any[]; nextCursor: string | null }> => {
  const limit = Math.max(1, Math.min(100, opts.limit || 50));

  let q = db()
    .from("listings")
    .select("*")
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (opts.communityId) {
    q = q.eq("community_id", opts.communityId);
  } else if (opts.zipCode) {
    q = q.eq("zip_code", opts.zipCode);
  }

  if (opts.cursor) {
    const cur = decodeCursor(opts.cursor);
    if (cur) {
      // (created_at, id) < (cursor.created_at, cursor.id), newest-first.
      q = q.or(
        `created_at.lt.${cur.createdAt},and(created_at.eq.${cur.createdAt},id.lt.${cur.id})`,
      );
    }
  }

  // Fetch one extra to know whether another page exists.
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { listings: page.map(listingFromRow), nextCursor };
};

// ── geo: "near me" (net-new) ──────────────────────────────────────────────────
// Active listings within a radius of (lat,lng), nearest-first, optionally scoped
// to a community. Backed by listings_near() (PostGIS ST_DWithin + GiST). This is
// the single place the "10 miles" default and the mile→meter conversion live.
const METERS_PER_MILE = 1609.34;
const DEFAULT_RADIUS_MILES = 10;

export const listingsNear = async (opts: {
  lat: number;
  lng: number;
  radiusMiles?: number;
  communityId?: string | null;
  limit?: number;
}) => {
  const radiusMiles = opts.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const { data, error } = await db().rpc("listings_near", {
    p_lat: opts.lat,
    p_lng: opts.lng,
    p_radius_meters: radiusMiles * METERS_PER_MILE,
    p_community_id: opts.communityId ?? null,
    p_limit: opts.limit ?? 50,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map(listingFromRow);
};

// ── communities (minimal; full CRUD lands with the communities vertical) ─────

export const communityFromRow = (r: any) => (r ? {
  id: r.id,
  name: r.name,
  zipCode: r.zip_code,
  createdBy: r.created_by ?? null,
  memberCount: Number(r.member_count ?? 0),
  createdAt: r.created_at,
} : null);

// Reads through communities_view so memberCount is computed, not stored.
export const getCommunity = async (id: string) => {
  const { data, error } = await db()
    .from("communities_view")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return communityFromRow(data);
};

// ── profiles ─────────────────────────────────────────────────────────────────
// Reads go through profiles_view so rating/ratingCount come from the ratings
// table (no stored, drift-prone counters).

export const getProfile = async (id: string) => {
  const { data, error } = await db()
    .from("profiles_view")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return profileFromRow(data);
};

// The user's active community id (replaces KV `user:<id>:community`). Stored on
// profiles.active_community_id; written by the communities vertical.
export const getActiveCommunityId = async (userId: string): Promise<string | null> => {
  const { data, error } = await db()
    .from("profiles")
    .select("active_community_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.active_community_id ?? null;
};
