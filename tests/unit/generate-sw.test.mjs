import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SERVICE_WORKER = join(ROOT, 'public', 'sw.js');
const LEGACY_FCM_WORKER = join(ROOT, 'public', 'firebase-messaging-sw.js');
const OUTPUTS = [SERVICE_WORKER, LEGACY_FCM_WORKER];

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:unit',
};

const EXPECTED_CONFIG = {
  apiKey: FIREBASE_ENV.VITE_FIREBASE_API_KEY,
  authDomain: FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_ENV.VITE_FIREBASE_APP_ID,
};

const DEV_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

function withGeneratedWorkerBackup(run) {
  const prior = new Map(OUTPUTS.map((path) => [path, readFileSync(path, 'utf8')]));
  try {
    run();
  } finally {
    for (const [path, contents] of prior) {
      writeFileSync(path, contents, 'utf8');
    }
  }
}

function runGenerateSw(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      NETLIFY: 'false',
      NETLIFY_INJECT_FIREBASE: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function readFirebaseConfig(path) {
  const contents = readFileSync(path, 'utf8');
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\n\})\);/);
  assert.ok(match, `${path} should initialize Firebase with an object literal`);
  assert.doesNotMatch(contents, /__FIREBASE_CONFIG__/);
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  it('writes supplied Firebase config into both generated service workers', () => {
    withGeneratedWorkerBackup(() => {
      const result = runGenerateSw(FIREBASE_ENV);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /generated service workers/);
      assert.deepEqual(readFirebaseConfig(SERVICE_WORKER), EXPECTED_CONFIG);
      assert.deepEqual(readFirebaseConfig(LEGACY_FCM_WORKER), EXPECTED_CONFIG);
    });
  });

  it('uses local placeholders for Netlify builds unless Firebase injection is enabled', () => {
    withGeneratedWorkerBackup(() => {
      const result = runGenerateSw({
        ...FIREBASE_ENV,
        NETLIFY: 'true',
        NETLIFY_INJECT_FIREBASE: 'false',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(readFirebaseConfig(SERVICE_WORKER), DEV_CONFIG);
      assert.deepEqual(readFirebaseConfig(LEGACY_FCM_WORKER), DEV_CONFIG);
    });
  });
});
