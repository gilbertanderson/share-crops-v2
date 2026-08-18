import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appSource = readFileSync(path.join(ROOT, 'server/app.ts'), 'utf8');
const dbSource = readFileSync(path.join(ROOT, 'server/db.ts'), 'utf8');
const completionMigration = readFileSync(
  path.join(ROOT, 'supabase/migrations/20260818170000_guard_offer_completion_status.sql'),
  'utf8',
);

describe('offer lifecycle guards', () => {
  it('only lets pending offers transition through seller accept or decline routes', () => {
    assert.match(appSource, /if \(offer\.status !== 'pending'\) \{\s+return c\.json\(\{ error: "Only pending offers can be accepted" \}, 400\);/);
    assert.match(appSource, /if \(offer\.status !== 'pending'\) \{\s+return c\.json\(\{ error: "Only pending offers can be declined" \}, 400\);/);
    assert.match(dbSource, /\.eq\("status", "pending"\)\s+\.select\(\)\s+\.maybeSingle\(\);/);
  });

  it('rejects accepting offers once the listing is no longer active', () => {
    assert.match(appSource, /const listing = await db\.getListing\(offer\.listingId\);/);
    assert.match(appSource, /if \(!listing \|\| listing\.status !== 'active' \|\| isListingExpired\(listing\)\) \{/);
    assert.match(appSource, /return c\.json\(\{ error: "This listing is no longer accepting offers" \}, 400\);/);
  });

  it('keeps completion atomic by refusing to complete a non-active listing', () => {
    assert.match(completionMigration, /if v_listing\.status <> 'active' then/);
    assert.match(completionMigration, /listing % is % \(expected active\)/);
    assert.match(completionMigration, /update listings set status = 'completed', seller_id = v_offer\.buyer_id/);
  });
});
