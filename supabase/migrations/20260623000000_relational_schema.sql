-- Share Crops — relational schema (migration B: KV → Postgres).
--
-- Additive: these tables live alongside the legacy kv_store_dd877831 /
-- listings_dd877831 store. Nothing here drops or reads the KV table; the route
-- rewrite (B3) switches reads/writes over, and the data backfill (B4) copies the
-- canonical `*:<id>` KV blobs into these tables. Until then the app is untouched.
--
-- Design notes (from the KV data-layer digest):
--   * The KV store keeps 3–4 copies of every entity (canonical + per-relation
--     index keys) kept in sync by hand. Here that collapses to one row + indexes.
--   * profiles.id is TEXT, not uuid: it mirrors the Supabase Auth uid today and
--     will hold a Firebase uid after migration A. All other entity PKs are uuid.
--   * Denormalized aggregates that were race-prone read-modify-writes in KV
--     (user.rating/ratingCount, community.memberCount) are NOT stored as columns;
--     they're computed by the *_view views below — drift-free by construction.
--   * Geo: the KV store had zip strings only (no lat/long). `location` is a
--     PostGIS point geocoded from the zip at backfill time; nullable until then.

create extension if not exists postgis;
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── reconcile prior attempt ──────────────────────────────────────────────────
-- An earlier (06-22) migration created these same tables WITHOUT the PostGIS
-- location columns, the *_view aggregates, or the listings_near/complete_offer
-- functions. All of them are empty (the live app still uses kv_store_dd877831),
-- so drop & recreate to guarantee the schema below — no data is affected.
-- Dependents first; CASCADE clears FKs, indexes, views, and functions.
drop view     if exists profiles_view    cascade;
drop view     if exists communities_view cascade;
drop function if exists listings_near(double precision, double precision, double precision, uuid, integer) cascade;
drop function if exists complete_offer(uuid, text) cascade;
drop table    if exists ratings             cascade;
drop table    if exists messages            cascade;
drop table    if exists thread_participants cascade;
drop table    if exists threads             cascade;
drop table    if exists offers              cascade;
drop table    if exists listings            cascade;
drop table    if exists community_members   cascade;
drop table    if exists communities         cascade;
drop table    if exists profiles            cascade;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Replaces KV `user:<id>`. active_community_id replaces `user:<id>:community`.
create table if not exists profiles (
  id                  text primary key,                 -- Supabase auth uid → Firebase uid (migration A)
  email               text unique not null,
  name                text not null default '',
  bio                 text,
  social_url          text,
  profile_photo_url   text,
  role                text not null default 'general' check (role in ('admin','general')),
  active_community_id uuid,                              -- FK added after communities exists
  created_at          timestamptz not null default now()
);

-- ── communities ─────────────────────────────────────────────────────────────
-- Replaces KV `community:id:<id>` (canonical) and `community:<zip>:<name>` (the
-- dedupe key → the unique(zip_code, lower(name)) constraint below).
create table if not exists communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  zip_code    text not null,
  created_by  text references profiles(id) on delete set null,
  location    geography(point, 4326),                   -- geocoded from zip_code
  created_at  timestamptz not null default now(),
  constraint communities_zip_name_unique unique (zip_code, name)
);
-- case-insensitive dedupe (KV normalized the name to lower+trim)
create unique index if not exists communities_zip_lname_uidx
  on communities (zip_code, lower(name));

alter table profiles
  drop constraint if exists profiles_active_community_fk,
  add  constraint profiles_active_community_fk
  foreign key (active_community_id) references communities(id) on delete set null;

-- ── community_members ───────────────────────────────────────────────────────
-- Replaces the bidirectional KV join pair `user:<uid>:community_member:<cid>` +
-- `community:member:<cid>:<uid>` (which could desync). One row, one truth.
create table if not exists community_members (
  community_id uuid not null references communities(id) on delete cascade,
  user_id      text not null references profiles(id)   on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on community_members (user_id);

-- ── listings ────────────────────────────────────────────────────────────────
-- Replaces KV `listing:<id>` + the `listing:community:*` / `listing:user:*` index
-- copies + the listings_dd877831 mirror. seller_id is mutable (ownership swaps to
-- the buyer on offer-complete — see complete_offer()).
create table if not exists listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    text not null references profiles(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  quantity     text,
  photos       text[] not null default '{}',
  looking_for  text,
  community_id uuid references communities(id) on delete set null,
  zip_code     text not null,
  location     geography(point, 4326),                  -- geocoded from zip_code
  status       text not null default 'active' check (status in ('active','completed','expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz
);
-- Feed access paths (mirror the existing listings_dd877831 btree indexes).
create index if not exists listings_community_feed_idx on listings (community_id, status, created_at desc);
create index if not exists listings_zip_feed_idx       on listings (zip_code, status, created_at desc);
create index if not exists listings_keyset_idx         on listings (created_at desc, id desc);
create index if not exists listings_seller_idx         on listings (seller_id);
-- "Near me" radius queries (net-new capability; KV had none).
create index if not exists listings_location_gix       on listings using gist (location);

-- ── offers ──────────────────────────────────────────────────────────────────
-- Replaces KV `offer:<id>` + `offer:listing:*` / `offer:buyer:*` / `offer:seller:*`.
create table if not exists offers (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  buyer_id        text not null references profiles(id) on delete cascade,
  seller_id       text not null references profiles(id) on delete cascade,
  offered_produce text not null,
  message         text,
  status          text not null default 'pending' check (status in ('pending','accepted','declined','completed')),
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  declined_at     timestamptz,
  completed_at    timestamptz
);
create index if not exists offers_listing_idx on offers (listing_id);
create index if not exists offers_buyer_idx   on offers (buyer_id, created_at desc);
create index if not exists offers_seller_idx  on offers (seller_id, created_at desc);
create index if not exists offers_status_idx  on offers (status);
-- Soft-uniqueness the KV layer enforced: one live offer per (listing, buyer, produce).
create unique index if not exists offers_live_dedupe_uidx
  on offers (listing_id, buyer_id, offered_produce)
  where status <> 'declined';

-- ── threads / participants / messages ───────────────────────────────────────
-- Surrogate uuid PK fixes the KV dual-id fragility (support = UUID,
-- DM = `<sortedUserIds>:<listingId>`). dedupe_key preserves the old DM-dedup
-- semantics (set it to the composite string for DM threads, null for support —
-- multiple nulls are allowed by the unique index).
create table if not exists threads (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid references listings(id) on delete set null,
  type            text not null default 'listing' check (type in ('listing','support')),
  title           text,
  dedupe_key      text unique,
  last_message    text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists thread_participants (
  thread_id uuid not null references threads(id) on delete cascade,
  user_id   text not null references profiles(id) on delete cascade,
  primary key (thread_id, user_id)
);
create index if not exists thread_participants_user_idx on thread_participants (user_id);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references threads(id) on delete cascade,
  sender_id  text not null references profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_idx on messages (thread_id, created_at);

-- ── ratings ─────────────────────────────────────────────────────────────────
-- Replaces KV `rating:<id>` + `rating:<offerId>:<rater>` (uniqueness) +
-- `rating:user:<rated>:*`. listing_snapshot preserves the rating if the listing
-- is later deleted; offer_id is set null (not cascaded) for the same reason.
create table if not exists ratings (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid references offers(id) on delete set null,
  rated_user_id  text not null references profiles(id) on delete cascade,
  rater_user_id  text not null references profiles(id) on delete cascade,
  rating         int  not null check (rating between 1 and 5),
  comment        text,
  listing_snapshot jsonb,
  created_at     timestamptz not null default now(),
  constraint ratings_offer_rater_unique unique (offer_id, rater_user_id)
);
create index if not exists ratings_rated_user_idx on ratings (rated_user_id);

-- ── views: drift-free aggregates ────────────────────────────────────────────
-- The app's JSON shapes expect user.rating/ratingCount and community.memberCount.
-- Compute them instead of storing them (kills the race-prone counters).
create or replace view profiles_view as
  select p.*,
         coalesce(round(avg(r.rating)::numeric, 2), 0) as rating,
         count(r.id)                                   as rating_count
  from profiles p
  left join ratings r on r.rated_user_id = p.id
  group by p.id;

create or replace view communities_view as
  select c.*,
         count(cm.user_id) as member_count
  from communities c
  left join community_members cm on cm.community_id = c.id
  group by c.id;

-- ── geo: "near me" ──────────────────────────────────────────────────────────
-- Net-new: active listings within :radius_meters of (:lat,:lng), nearest first.
-- Optionally scoped to a community. Backfill must populate listings.location.
create or replace function listings_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision default 16093,       -- ~10 miles
  p_community_id uuid default null,
  p_limit int default 50
)
returns setof listings
language sql stable as $$
  select l.*
  from listings l
  where l.status = 'active'
    and (l.expires_at is null or l.expires_at > now())
    and l.location is not null
    and st_dwithin(l.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
    and (p_community_id is null or l.community_id = p_community_id)
  order by l.location <-> st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  limit p_limit;
$$;

-- ── atomic offer-complete ───────────────────────────────────────────────────
-- The KV version did 9 non-atomic writes (4 offer copies + 4 listing copies +
-- index) and could partially fail mid-ownership-swap. This is one transaction:
-- guard ownership, mark offer completed, mark listing completed, transfer the
-- listing to the buyer. plpgsql functions are atomic — all or nothing.
create or replace function complete_offer(p_offer_id uuid, p_actor_id text)
returns offers
language plpgsql as $$
declare
  v_offer   offers;
  v_listing listings;
begin
  select * into v_offer from offers where id = p_offer_id for update;
  if not found then raise exception 'offer % not found', p_offer_id using errcode = 'no_data_found'; end if;

  select * into v_listing from listings where id = v_offer.listing_id for update;
  if not found then raise exception 'listing % not found', v_offer.listing_id using errcode = 'no_data_found'; end if;

  -- only a party to the offer may complete it
  if p_actor_id <> v_offer.seller_id and p_actor_id <> v_offer.buyer_id then
    raise exception 'actor % not party to offer %', p_actor_id, p_offer_id using errcode = 'insufficient_privilege';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'offer % is % (expected accepted)', p_offer_id, v_offer.status using errcode = 'check_violation';
  end if;

  update offers   set status = 'completed', completed_at = now() where id = v_offer.id   returning * into v_offer;
  update listings set status = 'completed', seller_id = v_offer.buyer_id where id = v_listing.id;  -- ownership swap
  return v_offer;
end;
$$;
