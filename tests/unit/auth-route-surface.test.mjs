import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));
const SERVER_APP = readFileSync(join(ROOT, 'server/app.ts'), 'utf8');
const EDGE_APP = readFileSync(join(ROOT, 'supabase/functions/_shared/app.ts'), 'utf8');

const legacyAuthRoutes = [
  '/make-server-dd877831/auth/signup',
  '/make-server-dd877831/auth/login',
  '/make-server-dd877831/auth/reset-password',
];

describe('backend auth route surface', () => {
  it('does not expose legacy Supabase-backed auth endpoints in either backend', () => {
    for (const route of legacyAuthRoutes) {
      assert.equal(SERVER_APP.includes(`app.post("${route}"`), false, `${route} in server/app.ts`);
      assert.equal(
        EDGE_APP.includes(`app.post("${route}"`),
        false,
        `${route} in supabase/functions/_shared/app.ts`,
      );
    }
  });
});
