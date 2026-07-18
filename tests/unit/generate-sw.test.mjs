import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const WORKERS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
};

const EXPECTED_CONFIG = {
  apiKey: FIREBASE_ENV.VITE_FIREBASE_API_KEY,
  authDomain: FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_ENV.VITE_FIREBASE_APP_ID,
};

function snapshotWorkers() {
  return new Map(
    WORKERS.map((worker) => [
      worker,
      existsSync(worker) ? readFileSync(worker, 'utf8') : null,
    ]),
  );
}

function restoreWorkers(snapshot) {
  for (const [worker, contents] of snapshot) {
    if (contents === null) {
      if (existsSync(worker)) unlinkSync(worker);
    } else {
      writeFileSync(worker, contents, 'utf8');
    }
  }
}

function readFirebaseConfig(worker) {
  const contents = readFileSync(worker, 'utf8');
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\n\})\);/);
  assert.ok(match, `${worker} should initialize Firebase with a config object`);
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  it('injects explicit production Firebase config into both service workers', () => {
    const snapshot = snapshotWorkers();
    try {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: {
          ...process.env,
          NETLIFY: '',
          NETLIFY_INJECT_FIREBASE: '',
          VERCEL: '',
          CI: '',
          NODE_ENV: 'test',
          ...FIREBASE_ENV,
        },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /generated service workers/);

      for (const worker of WORKERS) {
        const contents = readFileSync(worker, 'utf8');
        assert.deepEqual(readFirebaseConfig(worker), EXPECTED_CONFIG);
        assert.doesNotMatch(contents, /demo-share-crops|fake-api-key|1234567890/);
        assert.match(contents, /messaging\.onBackgroundMessage/);
      }
    } finally {
      restoreWorkers(snapshot);
    }
  });
});
