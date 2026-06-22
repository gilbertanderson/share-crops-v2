// @ts-nocheck
// Ported Deno backend; type-checked by the Deno runtime, not the Vercel/Node build.

// Secondary index for listings. The KV store (`listing:*` keys) remains the
// source of truth; this table mirrors the queryable columns + the full record
// so the marketplace feed can do an indexed WHERE + ORDER BY + LIMIT instead of
// scanning every `listing:community:` key and filtering/sorting in JS.
//
// Schema (created by migration, see supabase/migrations):
//   create table listings_dd877831 (
//     id text primary key,
//     seller_id text,
//     community_id text,
//     zip_code text,
//     status text not null default 'active',
//     created_at timestamptz not null default now(),
//     expires_at timestamptz,
//     data jsonb not null
//   );
//   + indexes on (community_id, status, created_at desc),
//                (zip_code, status, created_at desc),
//                (created_at desc, id desc)

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env.ts";

const TABLE = "listings_dd877831";

const client = () => createClient(
  getEnv("SUPABASE_URL")!,
  getEnv("SUPABASE_SERVICE_ROLE_KEY")!,
);

const row = (listing: any) => ({
  id: listing.id,
  seller_id: listing.sellerId ?? null,
  community_id: listing.communityId ?? null,
  zip_code: listing.zipCode ?? null,
  status: listing.status ?? "active",
  created_at: listing.createdAt ?? new Date().toISOString(),
  expires_at: listing.expiresAt ?? null,
  data: listing,
});

// Mirror a created/updated listing into the index. Best-effort: the KV write is
// the source of truth, so an index failure must not break the write path.
export const upsertListing = async (listing: any): Promise<void> => {
  if (!listing?.id) return;
  try {
    const { error } = await client().from(TABLE).upsert(row(listing));
    if (error) console.error("listings_index upsert error:", error.message);
  } catch (e) {
    console.error("listings_index upsert exception:", String(e));
  }
};

// Remove a listing from the index (deletion / expiry).
export const removeListing = async (id: string): Promise<void> => {
  if (!id) return;
  try {
    const { error } = await client().from(TABLE).delete().eq("id", id);
    if (error) console.error("listings_index remove error:", error.message);
  } catch (e) {
    console.error("listings_index remove exception:", String(e));
  }
};

const encodeCursor = (createdAt: string, id: string) =>
  btoa(`${createdAt}|${id}`);

const decodeCursor = (cursor: string): { createdAt: string; id: string } | null => {
  try {
    const [createdAt, id] = atob(cursor).split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

// Keyset-paginated feed query. Returns active, non-expired listings newest-first.
// Filters by communityId when given, else by zipCode, else across all (global).
export const queryListings = async (opts: {
  communityId?: string | null;
  zipCode?: string | null;
  limit: number;
  cursor?: string | null;
}): Promise<{ listings: any[]; nextCursor: string | null }> => {
  const limit = Math.max(1, Math.min(100, opts.limit || 50));

  let q = client()
    .from(TABLE)
    .select("created_at, id, data")
    .eq("status", "active")
    // Missing expiry means "never expires" (matches isListingExpired semantics).
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (opts.communityId) {
    q = q.eq("community_id", opts.communityId);
  } else if (opts.zipCode) {
    q = q.eq("zip_code", opts.zipCode);
  }

  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      // (created_at, id) < (cursor.created_at, cursor.id), newest-first.
      q = q.or(
        `created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`
      );
    }
  }

  // Fetch one extra row to know whether another page exists.
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

  return { listings: page.map((r: any) => r.data), nextCursor };
};
