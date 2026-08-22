import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
  'server/app.ts',
  'server/db.ts',
  'supabase/functions/_shared/app.ts',
  'supabase/functions/_shared/db.ts',
];

const source = Object.fromEntries(
  files.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]),
);

describe('destructive API route guards', () => {
  it('does not wildcard-allow Netlify preview origins in API CORS', () => {
    for (const file of ['server/app.ts', 'supabase/functions/_shared/app.ts']) {
      assert.doesNotMatch(source[file], /netlify\\\.app/);
      assert.match(source[file], /Netlify branch\/deploy-preview hosts are intentionally not wildcarded/);
    }
  });

  it('blocks listing deletes when offers would be cascade-deleted', () => {
    for (const file of ['server/app.ts', 'supabase/functions/_shared/app.ts']) {
      assert.match(source[file], /getProtectedOfferCountForListing\(id\)/);
      assert.match(source[file], /Listings with active or completed offers cannot be deleted/);
    }
    for (const file of ['server/db.ts', 'supabase/functions/_shared/db.ts']) {
      assert.match(source[file], /getProtectedOfferCountForListing/);
      assert.match(source[file], /\.in\("status", \["pending", "accepted", "completed"\]\)/);
    }
  });

  it('allows buyers to delete only pending offers', () => {
    for (const file of ['server/app.ts', 'supabase/functions/_shared/app.ts']) {
      assert.match(source[file], /offer\.status !== 'pending'/);
      assert.match(source[file], /Only pending offers can be deleted/);
    }
  });

  it('does not reassign an existing push token to another user', () => {
    for (const file of ['server/db.ts', 'supabase/functions/_shared/db.ts']) {
      assert.match(source[file], /class PushTokenOwnershipError extends Error/);
      assert.match(source[file], /existing\.user_id !== userId/);
      assert.doesNotMatch(source[file], /\.upsert\(\{ token, user_id: userId \}/);
    }
    for (const file of ['server/app.ts', 'supabase/functions/_shared/app.ts']) {
      assert.match(source[file], /PushTokenOwnershipError/);
      assert.match(source[file], /Push token is already registered to another user/);
    }
  });
});
