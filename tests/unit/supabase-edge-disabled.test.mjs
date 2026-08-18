import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const edgeEntry = readFileSync(
  path.join(ROOT, 'supabase/functions/make-server-dd877831/index.ts'),
  'utf8',
);

describe('Supabase Edge API entrypoint', () => {
  it('does not serve the stale shared Hono app', () => {
    assert.doesNotMatch(edgeEntry, /from "\.\.\/_shared\/app\.ts"/);
    assert.match(edgeEntry, /edgeApiDisabled/);
    assert.match(edgeEntry, /status: 503/);
  });
});
