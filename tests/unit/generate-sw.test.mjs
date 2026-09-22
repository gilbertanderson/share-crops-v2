import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');

const originalWorkers = {
  [SW]: readFileSync(SW, 'utf8'),
  [FCM_SW]: readFileSync(FCM_SW, 'utf8'),
};

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-test.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:testapp',
};

const EXPECTED_CONFIG = {
  apiKey: FIREBASE_ENV.VITE_FIREBASE_API_KEY,
  authDomain: FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_ENV.VITE_FIREBASE_APP_ID,
};

function cleanEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...overrides,
  };
}

function extractFirebaseConfig(workerSource) {
  const match = workerSource.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, 'expected worker to initialize Firebase');
  return JSON.parse(match[1]);
}

after(() => {
  for (const [path, source] of Object.entries(originalWorkers)) {
    writeFileSync(path, source, 'utf8');
  }
});

describe('generate-sw.mjs', () => {
  it('generates both service workers from explicit Firebase env', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: cleanEnv(FIREBASE_ENV),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const shellWorker = readFileSync(SW, 'utf8');
    const deprecatedFcmWorker = readFileSync(FCM_SW, 'utf8');

    assert.deepEqual(extractFirebaseConfig(shellWorker), EXPECTED_CONFIG);
    assert.deepEqual(extractFirebaseConfig(deprecatedFcmWorker), EXPECTED_CONFIG);
    assert.doesNotMatch(shellWorker + deprecatedFcmWorker, /__FIREBASE_CONFIG__/);
    assert.match(shellWorker, /messaging\.onBackgroundMessage/);
    assert.match(deprecatedFcmWorker, /messaging\.onBackgroundMessage/);
    assert.match(shellWorker, /self\.addEventListener\('fetch'/);
  });

  it('fails production generation instead of silently using dummy Firebase config', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: cleanEnv({ CI: 'true' }),
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /missing required Firebase env vars/);
    assert.match(result.stderr + result.stdout, /VITE_FIREBASE_API_KEY/);
  });

  it('keeps Netlify placeholder generation unless Firebase injection is enabled', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: cleanEnv({ NETLIFY: 'true' }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const shellWorker = readFileSync(SW, 'utf8');
    assert.deepEqual(extractFirebaseConfig(shellWorker), {
      apiKey: 'fake-api-key',
      authDomain: 'demo-share-crops.firebaseapp.com',
      projectId: 'demo-share-crops',
      storageBucket: 'demo-share-crops.appspot.com',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef',
    });
  });
});
