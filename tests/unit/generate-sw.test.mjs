import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');
const ENV_FILES = [join(ROOT, '.env.production.local'), join(ROOT, '.env.local')];

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '987654321',
  VITE_FIREBASE_APP_ID: '1:987654321:web:unit',
};

function withoutFirebaseEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(FIREBASE_ENV)) {
    delete env[key];
    delete env[`${key}_B64`];
  }
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  return { ...env, ...extraEnv };
}

function preserveFiles(paths, callback) {
  const originals = new Map(
    paths.map((path) => [
      path,
      existsSync(path) ? readFileSync(path, 'utf8') : null,
    ]),
  );

  try {
    return callback();
  } finally {
    for (const [path, content] of originals) {
      if (content === null) {
        if (existsSync(path)) unlinkSync(path);
      } else {
        writeFileSync(path, content, 'utf8');
      }
    }
  }
}

describe('generate-sw.mjs', () => {
  it('writes the resolved Firebase config into both service workers', () =>
    preserveFiles([SW, FCM_SW], () => {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: { ...withoutFirebaseEnv(), ...FIREBASE_ENV },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const path of [SW, FCM_SW]) {
        const contents = readFileSync(path, 'utf8');
        assert.match(contents, /firebase\.initializeApp\(\{/);
        assert.doesNotMatch(contents, /__FIREBASE_CONFIG__/);
        assert.match(contents, /"apiKey": "unit-api-key"/);
        assert.match(contents, /"authDomain": "unit-project\.firebaseapp\.com"/);
        assert.match(contents, /"projectId": "unit-project"/);
        assert.match(contents, /"storageBucket": "unit-project\.firebasestorage\.app"/);
        assert.match(contents, /"messagingSenderId": "987654321"/);
        assert.match(contents, /"appId": "1:987654321:web:unit"/);
      }
    }));

  it('fails production builds when Firebase config is absent', () =>
    preserveFiles([...ENV_FILES, SW, FCM_SW], () => {
      for (const path of ENV_FILES) {
        if (existsSync(path)) unlinkSync(path);
      }

      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: withoutFirebaseEnv({ CI: 'true', NODE_ENV: 'production' }),
        encoding: 'utf8',
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /missing required Firebase env vars for production build/);
      assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
    }));

  it('allows Netlify placeholder config when Firebase injection is disabled', () =>
    preserveFiles([...ENV_FILES, SW, FCM_SW], () => {
      for (const path of ENV_FILES) {
        if (existsSync(path)) unlinkSync(path);
      }

      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: withoutFirebaseEnv({ CI: 'true', NETLIFY: 'true' }),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(readFileSync(SW, 'utf8'), /"apiKey": "fake-api-key"/);
      assert.match(readFileSync(FCM_SW, 'utf8'), /"projectId": "demo-share-crops"/);
    }));
});
