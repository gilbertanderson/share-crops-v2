import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const TEST_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
};

const EXPECTED_TEST_CONFIG = {
  apiKey: TEST_ENV.VITE_FIREBASE_API_KEY,
  authDomain: TEST_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: TEST_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: TEST_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: TEST_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: TEST_ENV.VITE_FIREBASE_APP_ID,
};

const DEV_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

let swBackup;
let fcmBackup;

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_KEYS) delete env[key];
  delete env.CI;
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  delete env.NODE_ENV;
  delete env.VERCEL;
  return { ...env, ...overrides };
}

function runGenerator(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function readGenerated() {
  return {
    sw: readFileSync(SW, 'utf8'),
    fcm: readFileSync(FCM_SW, 'utf8'),
  };
}

function extractFirebaseConfig(contents) {
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\n\})\);/);
  assert.ok(match, `expected firebase.initializeApp config in:\n${contents}`);
  return JSON.parse(match[1]);
}

beforeEach(() => {
  swBackup = readFileSync(SW, 'utf8');
  fcmBackup = readFileSync(FCM_SW, 'utf8');
});

afterEach(() => {
  writeFileSync(SW, swBackup, 'utf8');
  writeFileSync(FCM_SW, fcmBackup, 'utf8');
});

describe('generate-sw.mjs', () => {
  it('writes the provided Firebase config to both service worker outputs', () => {
    const result = runGenerator(cleanEnv(TEST_ENV));

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const { sw, fcm } = readGenerated();
    assert.deepEqual(extractFirebaseConfig(sw), EXPECTED_TEST_CONFIG);
    assert.deepEqual(extractFirebaseConfig(fcm), EXPECTED_TEST_CONFIG);
    assert.match(sw, /url\.pathname\.startsWith\('\/api'\)/);
    assert.match(sw, /url\.pathname\.includes\('\/functions\/v1'\)/);
    assert.match(fcm, /DEPRECATED: FCM now runs inside \/sw\.js/);
  });

  it('uses local-safe placeholders for Netlify builds unless injection is explicitly enabled', () => {
    const result = runGenerator(cleanEnv({ ...TEST_ENV, NETLIFY: 'true' }));

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const { sw, fcm } = readGenerated();
    assert.deepEqual(extractFirebaseConfig(sw), DEV_CONFIG);
    assert.deepEqual(extractFirebaseConfig(fcm), DEV_CONFIG);
  });

  it('allows Netlify builds to inject the real Firebase config when requested', () => {
    const result = runGenerator(cleanEnv({
      ...TEST_ENV,
      NETLIFY: 'true',
      NETLIFY_INJECT_FIREBASE: 'true',
    }));

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const { sw, fcm } = readGenerated();
    assert.deepEqual(extractFirebaseConfig(sw), EXPECTED_TEST_CONFIG);
    assert.deepEqual(extractFirebaseConfig(fcm), EXPECTED_TEST_CONFIG);
  });
});
