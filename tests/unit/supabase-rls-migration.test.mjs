import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration = readFileSync(
  path.join(ROOT, 'supabase/migrations/20260822170448_lock_down_public_api_access.sql'),
  'utf8',
).toLowerCase();

const appTables = [
  'profiles',
  'communities',
  'community_members',
  'listings',
  'offers',
  'threads',
  'thread_participants',
  'messages',
  'ratings',
  'push_tokens',
];

describe('Supabase public schema lockdown migration', () => {
  it('enables RLS on every app table exposed through public', () => {
    for (const table of appTables) {
      assert.match(
        migration,
        new RegExp(`alter table if exists public\\.${table} enable row level security;`),
      );
    }
  });

  it('makes aggregate views obey caller permissions and revokes direct access', () => {
    assert.match(migration, /alter view if exists public\.profiles_view set \(security_invoker = true\);/);
    assert.match(migration, /alter view if exists public\.communities_view set \(security_invoker = true\);/);
    assert.match(migration, /revoke all on table[\s\S]*from anon, authenticated;/);
    assert.match(migration, /public\.profiles_view/);
    assert.match(migration, /public\.communities_view/);
  });

  it('revokes direct RPC execution for service-role-only functions', () => {
    assert.match(migration, /revoke execute on function public\.listings_near/);
    assert.match(migration, /revoke execute on function public\.complete_offer/);
  });
});
