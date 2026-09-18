import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');
const ENV_LOCAL = join(ROOT, '.env.local');
const ENV_PRODUCTION_LOCAL = join(ROOT, '.env.production.local');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const TEST_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'test-production-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:unit-test',
};

const EXPECTED_CONFIG = {
  apiKey: TEST_FIREBASE_ENV.VITE_FIREBASE_API_KEY,
  authDomain: TEST_FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: TEST_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: TEST_FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: TEST_FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: TEST_FIREBASE_ENV.VITE_FIREBASE_APP_ID,
};

function snapshotFiles(paths) {
  return new Map(
    paths.map((file) => [
      file,
      existsSync(file) ? readFileSync(file, 'utf8') : null,
    ]),
  );
}

function restoreFiles(snapshot) {
  for (const [file, content] of snapshot) {
    if (content === null) {
      if (existsSync(file)) unlinkSync(file);
    } else {
      writeFileSync(file, content, 'utf8');
    }
  }
}

function withFilesRestored(paths, fn) {
  const snapshot = snapshotFiles(paths);
  try {
    return fn();
  } finally {
    restoreFiles(snapshot);
  }
}

function runGenerateSw(env) {
  const clearedFirebaseEnv = Object.fromEntries(FIREBASE_KEYS.map((key) => [key, '']));
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...clearedFirebaseEnv,
      CI: '',
      NETLIFY: '',
      VERCEL: '',
      NODE_ENV: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function firebaseConfigFromWorker(file) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, `expected firebase.initializeApp config in ${file}`);
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  it('writes explicit Firebase web config into both service workers', () => {
    withFilesRestored([SW, FCM_SW], () => {
      const result = runGenerateSw(TEST_FIREBASE_ENV);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(firebaseConfigFromWorker(SW), EXPECTED_CONFIG);
      assert.deepEqual(firebaseConfigFromWorker(FCM_SW), EXPECTED_CONFIG);
    });
  });

  it('fails production builds instead of generating workers with local placeholders', () => {
    withFilesRestored([SW, FCM_SW, ENV_LOCAL, ENV_PRODUCTION_LOCAL], () => {
      writeFileSync(ENV_LOCAL, '', 'utf8');
      writeFileSync(ENV_PRODUCTION_LOCAL, '', 'utf8');

      const result = runGenerateSw({ CI: 'true' });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, /missing required Firebase env vars/);
      assert.match(result.stderr + result.stdout, /VITE_FIREBASE_API_KEY/);
    });
  });
});
