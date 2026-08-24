import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_BUNDLE = path.join(ROOT, 'api/index.js');
const BUILD_API = path.join(ROOT, 'scripts/build-api.mjs');

const ENV = {
  ADMIN_EMAIL: 'admin@example.com',
  APP_ID: 'dd877831',
  STORAGE_BUCKET_NAME: 'make-dd877831-sharecrops',
  KV_TABLE_NAME: 'kv_store_dd877831',
  CORS_ORIGINS: 'https://share-crops-v2.vercel.app',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  FIREBASE_PROJECT_ID: 'share-crops-app',
};

function runHandler(url, init = {}) {
  const script = `
    import { GET } from './api/index.js';
    const res = await GET(new Request(${JSON.stringify(url)}, ${JSON.stringify(init)}));
    const body = await res.text();
    console.log(JSON.stringify({ status: res.status, body }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: { ...process.env, ...ENV },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = (result.stdout || '').trim().split('\n');
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'));
  assert.ok(jsonLine, `expected JSON line in stdout: ${result.stdout}`);
  return JSON.parse(jsonLine);
}

describe('Vercel API path restoration', () => {
  before(() => {
    if (!existsSync(API_BUNDLE) || statSync(API_BUNDLE).size < 10_000) {
      const result = spawnSync(process.execPath, [BUILD_API], { cwd: ROOT, stdio: 'pipe' });
      assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
    }
  });

  it('serves health on a full /api/... path', () => {
    const out = runHandler('https://share-crops-v2.vercel.app/api/make-server-dd877831/health');
    assert.equal(out.status, 200);
    assert.match(out.body, /"status":"ok"/);
  });

  it('restores subpath from __path rewrite query param', () => {
    const out = runHandler('https://share-crops-v2.vercel.app/api/index?__path=make-server-dd877831/health');
    assert.equal(out.status, 200);
    assert.match(out.body, /"status":"ok"/);
  });

  for (const header of ['x-vercel-invoke-path', 'x-matched-path', 'x-forwarded-uri']) {
    it(`restores subpath from ${header} when Vercel invokes /api/index`, () => {
      const out = runHandler('https://share-crops-v2.vercel.app/api/index', {
        headers: { [header]: '/api/make-server-dd877831/health' },
      });
      assert.equal(out.status, 200);
      assert.match(out.body, /"status":"ok"/);
    });
  }

  it('returns 404 when rewrite strips path with no restoration hint', () => {
    const out = runHandler('https://share-crops-v2.vercel.app/api');
    assert.equal(out.status, 404);
  });
});
