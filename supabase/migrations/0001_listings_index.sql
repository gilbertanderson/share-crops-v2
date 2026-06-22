-- Secondary index table for the marketplace feed. The KV store (`listing:*`
-- keys in kv_store_dd877831) stays the source of truth; this table mirrors the
-- queryable columns + the full record so GET /listings can do an indexed
-- WHERE + ORDER BY + LIMIT instead of scanning every listing and sorting in JS.

create table if not exists listings_dd877831 (
  id          text primary key,
  seller_id   text,
  community_id text,
  zip_code    text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  data        jsonb not null
);

-- Community feed: WHERE community_id = ? AND status = 'active' ORDER BY created_at DESC
create index if not exists idx_listings_dd877831_community
  on listings_dd877831 (community_id, status, created_at desc);

-- ZIP ("All ZIP") feed: WHERE zip_code = ? AND status = 'active' ORDER BY created_at DESC
create index if not exists idx_listings_dd877831_zip
  on listings_dd877831 (zip_code, status, created_at desc);

-- Global ("All communities") feed + keyset cursor: ORDER BY created_at DESC, id DESC
create index if not exists idx_listings_dd877831_created
  on listings_dd877831 (created_at desc, id desc);

-- One-time backfill from the canonical KV listing keys (`listing:{id}`, i.e.
-- not the `listing:community:*` / `listing:user:*` mirror keys). Idempotent.
insert into listings_dd877831 (id, seller_id, community_id, zip_code, status, created_at, expires_at, data)
select
  value->>'id',
  value->>'sellerId',
  value->>'communityId',
  value->>'zipCode',
  coalesce(value->>'status', 'active'),
  coalesce((value->>'createdAt')::timestamptz, now()),
  nullif(value->>'expiresAt', '')::timestamptz,
  value
from kv_store_dd877831
where key like 'listing:%'
  and key not like 'listing:community:%'
  and key not like 'listing:user:%'
  and value->>'id' is not null
on conflict (id) do update set
  seller_id    = excluded.seller_id,
  community_id = excluded.community_id,
  zip_code     = excluded.zip_code,
  status       = excluded.status,
  created_at   = excluded.created_at,
  expires_at   = excluded.expires_at,
  data         = excluded.data;
