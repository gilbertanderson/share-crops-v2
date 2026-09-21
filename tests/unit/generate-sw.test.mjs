import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const OUTPUTS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-test.firebasestorage.app',
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

function snapshotOutputs() {
  return new Map(
    OUTPUTS.map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]),
  );
}

function restoreOutputs(snapshot) {
  for (const [path, contents] of snapshot.entries()) {
    if (contents === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      writeFileSync(path, contents, 'utf8');
    }
  }
}

function extractFirebaseConfig(source) {
  const match = source.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, 'service worker should initialize Firebase with an object literal');
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  it('writes the same Firebase config into active and legacy messaging service workers', () => {
    const snapshot = snapshotOutputs();
    try {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: {
          ...process.env,
          ...FIREBASE_ENV,
          CI: '',
          NETLIFY: '',
          VERCEL: '',
          NODE_ENV: 'test',
        },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /generated service workers/);

      const [activeWorker, legacyWorker] = OUTPUTS.map((path) => readFileSync(path, 'utf8'));
      assert.deepEqual(extractFirebaseConfig(activeWorker), EXPECTED_CONFIG);
      assert.deepEqual(extractFirebaseConfig(legacyWorker), EXPECTED_CONFIG);
      assert.match(activeWorker, /firebase-messaging-compat\.js/);
      assert.match(activeWorker, /messaging\.onBackgroundMessage/);
      assert.match(legacyWorker, /firebase-messaging-compat\.js/);
      assert.match(legacyWorker, /messaging\.onBackgroundMessage/);
    } finally {
      restoreOutputs(snapshot);
    }
  });
});
