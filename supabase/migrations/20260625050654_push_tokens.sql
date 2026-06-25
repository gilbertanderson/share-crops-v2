-- FCM web-push device tokens. One row per device token, owned by a profile.
-- Upserted by token on registration (POST /push/register); cascades on profile
-- deletion. Applied to the remote DB via the Supabase MCP; this file mirrors it
-- so the CLI migration history stays consistent.
create table if not exists push_tokens (
  token      text primary key,
  user_id    text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens (user_id);
