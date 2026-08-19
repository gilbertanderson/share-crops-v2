import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SERVICE_WORKER = join(ROOT, 'public', 'sw.js');
const LEGACY_FCM_WORKER = join(ROOT, 'public', 'firebase-messaging-sw.js');

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'ci-api-key-for-service-worker',
  VITE_FIREBASE_AUTH_DOMAIN: 'ci-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'ci-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'ci-share-crops.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:serviceworker',
};

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function restore(path, contents) {
  if (contents !== null) writeFileSync(path, contents, 'utf8');
}

function extractFirebaseConfig(contents) {
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, 'expected a Firebase initializeApp config literal');
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  it('injects CI Firebase config into both active and legacy service workers', () => {
    const priorServiceWorker = readIfPresent(SERVICE_WORKER);
    const priorLegacyWorker = readIfPresent(LEGACY_FCM_WORKER);

    try {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: { ...process.env, CI: 'true', ...FIREBASE_ENV },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);

      const expectedConfig = {
        apiKey: FIREBASE_ENV.VITE_FIREBASE_API_KEY,
        authDomain: FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
        storageBucket: FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: FIREBASE_ENV.VITE_FIREBASE_APP_ID,
      };

      assert.deepEqual(extractFirebaseConfig(readFileSync(SERVICE_WORKER, 'utf8')), expectedConfig);
      assert.deepEqual(extractFirebaseConfig(readFileSync(LEGACY_FCM_WORKER, 'utf8')), expectedConfig);
    } finally {
      restore(SERVICE_WORKER, priorServiceWorker);
      restore(LEGACY_FCM_WORKER, priorLegacyWorker);
    }
  });
});
