// @ts-nocheck
// Ported Deno backend; type-checked by the Deno runtime, not the Vercel/Node build.
//
// Relational data-access layer (migration B3). Replaces the hand-synced KV blobs
// (`listing:*`, `user:*`, etc.) and the listings_dd877831 mirror with the single
// normalized schema in supabase/migrations/20260624042719_relational_schema.sql.
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

// ── trending: active listings ranked by offer count ──────────────────────────
// Scoped to a zip or a community. Offer counts come from one batched query over
// the candidate listings (no per-listing offer scan).
export const getTrending = async (opts: {
  zipCode?: string | null;
  communityId?: string | null;
  limit?: number;
}) => {
  let lq = db()
    .from("listings")
    .select("*")
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (opts.communityId) lq = lq.eq("community_id", opts.communityId);
  else if (opts.zipCode) lq = lq.eq("zip_code", opts.zipCode);

  const { data: listings, error } = await lq;
  if (error) throw new Error(error.message);
  if (!listings || listings.length === 0) return [];

  const ids = listings.map((l: any) => l.id);
  const { data: offerRows, error: oErr } = await db()
    .from("offers")
    .select("listing_id")
    .in("listing_id", ids);
  if (oErr) throw new Error(oErr.message);

  const counts = new Map<string, number>();
  for (const o of offerRows ?? []) counts.set(o.listing_id, (counts.get(o.listing_id) ?? 0) + 1);

  const ranked = listings
    .map((l: any) => ({ listing: listingFromRow(l), offerCount: counts.get(l.id) ?? 0 }))
    .sort((a, b) =>
      b.offerCount !== a.offerCount
        ? b.offerCount - a.offerCount
        : new Date(b.listing!.createdAt || 0).getTime() - new Date(a.listing!.createdAt || 0).getTime(),
    );

  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
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

// ── offers ───────────────────────────────────────────────────────────────────

export const offerFromRow = (r: any) => (r ? {
  id: r.id,
  listingId: r.listing_id,
  buyerId: r.buyer_id,
  sellerId: r.seller_id,
  offeredProduce: r.offered_produce,
  message: r.message ?? "",
  status: r.status,
  createdAt: r.created_at,
  acceptedAt: r.accepted_at ?? null,
  declinedAt: r.declined_at ?? null,
  completedAt: r.completed_at ?? null,
} : null);

// Thrown when the offers_live_dedupe_uidx partial-unique index rejects a second
// live (listing, buyer, produce) offer — the DB enforces what the KV layer used
// to enforce with a buyer-offers scan (now race-free).
export class DuplicateOfferError extends Error {}

export const insertOffer = async (offer: any) => {
  const { data, error } = await db()
    .from("offers")
    .insert({
      id: offer.id,
      listing_id: offer.listingId,
      buyer_id: offer.buyerId,
      seller_id: offer.sellerId,
      offered_produce: offer.offeredProduce,
      message: offer.message ?? "",
      status: offer.status ?? "pending",
      created_at: offer.createdAt ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateOfferError(error.message);
    throw new Error(error.message);
  }
  return offerFromRow(data);
};

export const getOffer = async (id: string) => {
  const { data, error } = await db()
    .from("offers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return offerFromRow(data);
};

// accept / decline — sets status and the matching timestamp column.
export const setOfferStatus = async (id: string, status: "accepted" | "declined") => {
  const stamp = status === "accepted" ? "accepted_at" : "declined_at";
  const { data, error } = await db()
    .from("offers")
    .update({ status, [stamp]: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return offerFromRow(data);
};

// Atomic completion + listing ownership swap (complete_offer plpgsql function).
// Replaces the KV version's 9 non-atomic writes; the actor/status guards run
// under row locks inside the transaction.
export const completeOffer = async (offerId: string, actorId: string) => {
  const { data, error } = await db().rpc("complete_offer", {
    p_offer_id: offerId,
    p_actor_id: actorId,
  });
  if (error) throw new Error(error.message);
  // plpgsql `returns offers` surfaces as a single row (or a 1-element array).
  return offerFromRow(Array.isArray(data) ? data[0] : data);
};

export const deleteOffer = async (id: string) => {
  const { error } = await db().from("offers").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

// A user's offers as buyer, seller, or both — newest-first.
export const getOffersByUser = async (userId: string, as?: "buyer" | "seller" | null) => {
  let q = db().from("offers").select("*");
  if (as === "buyer") q = q.eq("buyer_id", userId);
  else if (as === "seller") q = q.eq("seller_id", userId);
  else q = q.or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(offerFromRow);
};

// ── chat: threads / participants / messages ──────────────────────────────────
// The wire thread keeps its inline participants[] array and the legacy
// listingId:'support' sentinel; storage normalizes to threads +
// thread_participants. dedupe_key replaces the old composite-id dedupe (DM:
// `<sortedUserIds>:<listingId>`, support: `support:<userId>`).

const threadFromRow = (r: any, participantIds: string[]) => (r ? {
  id: r.id,
  // Preserve the old 'support' sentinel the frontend keys on; DMs carry the uuid.
  listingId: r.listing_id ?? (r.type === "support" ? "support" : null),
  type: r.type,
  title: r.title ?? null,
  participants: participantIds,
  lastMessage: r.last_message ?? "",
  lastMessageAt: r.last_message_at ?? r.created_at,
  createdAt: r.created_at,
} : null);

const messageFromRow = (r: any) => (r ? {
  id: r.id,
  threadId: r.thread_id,
  senderId: r.sender_id,
  content: r.content,
  createdAt: r.created_at,
} : null);

export const getThreadByDedupe = async (dedupeKey: string) => {
  const { data, error } = await db()
    .from("threads")
    .select("*")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return threadFromRow(data, await getThreadParticipantIds(data.id));
};

export const getThread = async (id: string) => {
  const { data, error } = await db().from("threads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return threadFromRow(data, await getThreadParticipantIds(id));
};

const getThreadParticipantIds = async (threadId: string): Promise<string[]> => {
  const { data, error } = await db()
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", threadId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.user_id);
};

export const isThreadParticipant = async (threadId: string, userId: string): Promise<boolean> => {
  const { data, error } = await db()
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
};

export const createThread = async (input: {
  listingId?: string | null;
  type?: "listing" | "support";
  title?: string | null;
  dedupeKey?: string | null;
  participantIds: string[];
}) => {
  const { data, error } = await db()
    .from("threads")
    .insert({
      listing_id: input.listingId ?? null,
      type: input.type ?? "listing",
      title: input.title ?? null,
      dedupe_key: input.dedupeKey ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const rows = input.participantIds.map((uid) => ({ thread_id: data.id, user_id: uid }));
  const { error: pErr } = await db().from("thread_participants").insert(rows);
  if (pErr) throw new Error(pErr.message);

  return threadFromRow(data, input.participantIds);
};

// A user's threads, newest-activity first, with participants assembled in one
// extra query (no per-thread round trip).
export const listThreadsForUser = async (userId: string) => {
  const { data: mine, error: mErr } = await db()
    .from("thread_participants")
    .select("thread_id")
    .eq("user_id", userId);
  if (mErr) throw new Error(mErr.message);
  const threadIds = (mine ?? []).map((r: any) => r.thread_id);
  if (threadIds.length === 0) return [];

  const { data: threads, error: tErr } = await db()
    .from("threads")
    .select("*")
    .in("id", threadIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (tErr) throw new Error(tErr.message);

  const { data: parts, error: pErr } = await db()
    .from("thread_participants")
    .select("thread_id, user_id")
    .in("thread_id", threadIds);
  if (pErr) throw new Error(pErr.message);

  const byThread = new Map<string, string[]>();
  for (const p of parts ?? []) {
    const list = byThread.get(p.thread_id) ?? [];
    list.push(p.user_id);
    byThread.set(p.thread_id, list);
  }
  return (threads ?? []).map((t: any) => threadFromRow(t, byThread.get(t.id) ?? []));
};

export const insertMessage = async (threadId: string, senderId: string, content: string) => {
  const { data, error } = await db()
    .from("messages")
    .insert({ thread_id: threadId, sender_id: senderId, content })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Denormalized thread preview for the thread list.
  const { error: uErr } = await db()
    .from("threads")
    .update({ last_message: content, last_message_at: data.created_at })
    .eq("id", threadId);
  if (uErr) throw new Error(uErr.message);

  return messageFromRow(data);
};

export const listMessages = async (threadId: string) => {
  const { data, error } = await db()
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(messageFromRow);
};

export const getMessage = async (id: string) => {
  const { data, error } = await db().from("messages").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return messageFromRow(data);
};

export const deleteMessage = async (id: string) => {
  const { error } = await db().from("messages").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

// ── ratings ──────────────────────────────────────────────────────────────────
// Aggregates (a user's avg rating + count) are computed by profiles_view, so a
// rating write/delete no longer touches the rated user's row.

export const ratingFromRow = (r: any) => (r ? {
  id: r.id,
  offerId: r.offer_id,
  ratedUserId: r.rated_user_id,
  raterUserId: r.rater_user_id,
  rating: r.rating,
  comment: r.comment ?? "",
  listingSnapshot: r.listing_snapshot ?? null,
  createdAt: r.created_at,
} : null);

// Thrown when ratings_offer_rater_unique rejects a second rating from the same
// rater on the same offer.
export class DuplicateRatingError extends Error {}

export const insertRating = async (rating: any) => {
  const { data, error } = await db()
    .from("ratings")
    .insert({
      offer_id: rating.offerId,
      rated_user_id: rating.ratedUserId,
      rater_user_id: rating.raterUserId,
      rating: rating.rating,
      comment: rating.comment ?? "",
      listing_snapshot: rating.listingSnapshot ?? null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateRatingError(error.message);
    throw new Error(error.message);
  }
  return ratingFromRow(data);
};

export const getRating = async (id: string) => {
  const { data, error } = await db().from("ratings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return ratingFromRow(data);
};

export const getRatingsForUser = async (userId: string) => {
  const { data, error } = await db()
    .from("ratings")
    .select("*")
    .eq("rated_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(ratingFromRow);
};

export const deleteRating = async (id: string) => {
  const { error } = await db().from("ratings").delete().eq("id", id);
  if (error) throw new Error(error.message);
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

// Thrown when communities_zip_lname_uidx rejects a duplicate (zip, lower(name)).
export class DuplicateCommunityError extends Error {}

export const createCommunity = async (input: { name: string; zipCode: string; createdBy: string }) => {
  const { data, error } = await db()
    .from("communities")
    .insert({ name: input.name, zip_code: input.zipCode, created_by: input.createdBy })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateCommunityError(error.message);
    throw new Error(error.message);
  }
  // Fresh row → memberCount starts at 0 (the creator's membership is added next).
  return communityFromRow(data);
};

export const searchCommunitiesByZip = async (zipCode: string) => {
  const { data, error } = await db()
    .from("communities_view")
    .select("*")
    .eq("zip_code", zipCode)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(communityFromRow);
};

export const getAllCommunities = async () => {
  const { data, error } = await db()
    .from("communities_view")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(communityFromRow);
};

// ── community membership ─────────────────────────────────────────────────────
// One row per (community, user) — replaces the bidirectional KV index pair, so
// there's nothing to keep in sync and no memberCount to recompute.

export const addMembership = async (userId: string, communityId: string) => {
  // Idempotent: re-joining is a no-op, not a duplicate-key error.
  const { error } = await db()
    .from("community_members")
    .upsert({ community_id: communityId, user_id: userId }, { onConflict: "community_id,user_id" });
  if (error) throw new Error(error.message);
};

export const isMember = async (userId: string, communityId: string): Promise<boolean> => {
  const { data, error } = await db()
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
};

export const removeMembership = async (userId: string, communityId: string) => {
  const { error } = await db()
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
};

export const getMembershipCommunityIds = async (userId: string): Promise<string[]> => {
  const { data, error } = await db()
    .from("community_members")
    .select("community_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.community_id);
};

// Communities a user belongs to (full DTOs, joined order).
export const getMemberCommunities = async (userId: string) => {
  const ids = await getMembershipCommunityIds(userId);
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("communities_view")
    .select("*")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map(communityFromRow);
};

// Members of a community as profile DTOs + joinedAt. `limit` caps the result
// (e.g. the 12-avatar preview); omit for the full roster.
export const listCommunityMembers = async (communityId: string, limit?: number) => {
  let mq = db()
    .from("community_members")
    .select("user_id, joined_at")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });
  if (limit) mq = mq.limit(limit);

  const { data: rows, error } = await mq;
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r: any) => r.user_id);
  const { data: profiles, error: pErr } = await db()
    .from("profiles_view")
    .select("*")
    .in("id", ids);
  if (pErr) throw new Error(pErr.message);

  const byId = new Map((profiles ?? []).map((p: any) => [p.id, profileFromRow(p)]));
  return rows
    .map((r: any) => {
      const profile = byId.get(r.user_id);
      return profile ? { ...profile, joinedAt: r.joined_at } : null;
    })
    .filter(Boolean);
};

// Remove every member of a community; returns how many rows were deleted.
export const clearCommunityMembers = async (communityId: string): Promise<string[]> => {
  const { data, error } = await db()
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .select("user_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.user_id);
};

// Active community (profiles.active_community_id). null clears it.
export const setActiveCommunityId = async (userId: string, communityId: string | null) => {
  const { error } = await db()
    .from("profiles")
    .update({ active_community_id: communityId })
    .eq("id", userId);
  if (error) throw new Error(error.message);
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

// Profile fields the app writes (DTO camelCase → profiles columns). Only defined
// keys are emitted, so this drives both insert and partial update.
const profileToRow = (p: any) => {
  const row: Record<string, unknown> = {};
  if (p.id !== undefined) row.id = p.id;
  if (p.email !== undefined) row.email = p.email;
  if (p.name !== undefined) row.name = p.name;
  if (p.bio !== undefined) row.bio = p.bio;
  if (p.socialUrl !== undefined) row.social_url = p.socialUrl;
  if (p.profilePhotoUrl !== undefined) row.profile_photo_url = p.profilePhotoUrl;
  if (p.role !== undefined) row.role = p.role;
  if (p.activeCommunityId !== undefined) row.active_community_id = p.activeCommunityId;
  return row;
};

// Insert-or-replace a profile (signup, OAuth auto-provision). Reads come back
// through profiles_view so rating/ratingCount are populated.
export const upsertProfile = async (profile: any) => {
  const { error } = await db().from("profiles").upsert(profileToRow(profile), { onConflict: "id" });
  if (error) throw new Error(error.message);
  return getProfile(profile.id);
};

export const updateProfile = async (id: string, fields: any) => {
  const { error } = await db().from("profiles").update(profileToRow(fields)).eq("id", id);
  if (error) throw new Error(error.message);
  return getProfile(id);
};

// Admin user ids (replaces the `role:admin:*` KV index — now just a column).
export const getAdminUserIds = async (): Promise<string[]> => {
  const { data, error } = await db()
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.id);
};
