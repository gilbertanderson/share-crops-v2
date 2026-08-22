-- Lock down the relational marketplace schema from direct Supabase Data API
-- access. The Hono APIs use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS; the
-- browser may hold the anon key for Edge Function failover and must not be able
-- to read or mutate these tables/views directly through PostgREST/RPC.

alter table if exists public.profiles enable row level security;
alter table if exists public.communities enable row level security;
alter table if exists public.community_members enable row level security;
alter table if exists public.listings enable row level security;
alter table if exists public.offers enable row level security;
alter table if exists public.threads enable row level security;
alter table if exists public.thread_participants enable row level security;
alter table if exists public.messages enable row level security;
alter table if exists public.ratings enable row level security;
alter table if exists public.push_tokens enable row level security;

-- Views in public are otherwise security-definer and can bypass table RLS.
-- Supabase runs Postgres 15+, where security_invoker makes view reads obey the
-- caller's table privileges/policies.
alter view if exists public.profiles_view set (security_invoker = true);
alter view if exists public.communities_view set (security_invoker = true);

revoke all on table
  public.profiles,
  public.communities,
  public.community_members,
  public.listings,
  public.offers,
  public.threads,
  public.thread_participants,
  public.messages,
  public.ratings,
  public.push_tokens,
  public.profiles_view,
  public.communities_view
from anon, authenticated;

revoke execute on function public.listings_near(double precision, double precision, double precision, uuid, integer)
from anon, authenticated;

revoke execute on function public.complete_offer(uuid, text)
from anon, authenticated;
