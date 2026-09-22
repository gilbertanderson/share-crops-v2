import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_APPS = [
  'server/app.ts',
  'supabase/functions/_shared/app.ts',
];
const DB_MODULES = [
  'server/db.ts',
  'supabase/functions/_shared/db.ts',
];

describe('public profile responses', () => {
  for (const rel of DB_MODULES) {
    it(`${rel} exposes a public profile mapper that omits private fields`, () => {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const mapperStart = source.indexOf('export const publicProfileFromProfile');
      assert.notEqual(mapperStart, -1);
      const mapperEnd = source.indexOf('// ── listings', mapperStart);
      const mapper = source.slice(mapperStart, mapperEnd);

      assert.match(mapper, /id:/);
      assert.match(mapper, /name:/);
      assert.doesNotMatch(mapper, /email/);
      assert.doesNotMatch(mapper, /role/);
      assert.doesNotMatch(mapper, /activeCommunityId/);
    });
  }

  for (const rel of API_APPS) {
    it(`${rel} wraps unauthenticated profile responses with the public mapper`, () => {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');

      assert.match(source, /seller = publicProfile\(await db\.getProfile\(listing\.sellerId\)\)/);
      assert.match(source, /return c\.json\(\{ profile: publicProfile\(profile\) \}\)/);
    });
  }
});
