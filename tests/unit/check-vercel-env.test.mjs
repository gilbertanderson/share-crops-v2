import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-vercel-env.mjs');

const BASE_ENV = {
  VITE_FIREBASE_API_KEY: 'fake-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  FIREBASE_PROJECT_ID: 'share-crops-app',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  ADMIN_EMAIL: 'admin@example.com',
  APP_ID: 'dd877831',
  STORAGE_BUCKET_NAME: 'make-dd877831-sharecrops',
  KV_TABLE_NAME: 'kv_store_dd877831',
  CORS_ORIGINS: 'https://share-crops-v2.vercel.app,http://localhost:5173',
};

function runChecker(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, ...BASE_ENV, ...extraEnv },
    encoding: 'utf8',
  });
}

describe('check-vercel-env.mjs', () => {
  it('exits 0 when required Firebase vars are present', () => {
    const result = runChecker();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /required Vercel environment variables are present/);
  });

  it('exits 1 when a required Firebase var is missing', () => {
    const result = runChecker({ VITE_FIREBASE_API_KEY: '' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
  });

  it('exits 1 when client and server Firebase project ids disagree', () => {
    const result = runChecker({ FIREBASE_PROJECT_ID: 'other-project' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must match FIREBASE_PROJECT_ID/);
  });

  it('accepts VITE_FIREBASE_* values supplied via *_B64 env vars', () => {
    const result = runChecker({
      VITE_FIREBASE_API_KEY: '',
      VITE_FIREBASE_API_KEY_B64: Buffer.from('from-b64-key').toString('base64'),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('warns when only one Netlify Blobs var is set', () => {
    const result = runChecker({ NETLIFY_BLOBS_SITE_ID: 'site-id' });
    assert.equal(result.status, 0);
    assert.match(result.stdout + result.stderr, /NETLIFY_BLOBS_SITE_ID and NETLIFY_BLOBS_TOKEN must both be set/);
  });

  it('confirms when Netlify Blobs is fully configured', () => {
    const result = runChecker({
      NETLIFY_BLOBS_SITE_ID: 'site-id',
      NETLIFY_BLOBS_TOKEN: 'token',
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Netlify Blobs image storage is configured/);
  });
});
