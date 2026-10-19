import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SERVICE_WORKERS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const EXPLICIT_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-test.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:unit-test',
};

const EXPLICIT_CONFIG = {
  apiKey: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_API_KEY,
  authDomain: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: EXPLICIT_FIREBASE_ENV.VITE_FIREBASE_APP_ID,
};

function backupServiceWorkers() {
  return SERVICE_WORKERS.map((file) => ({
    file,
    contents: existsSync(file) ? readFileSync(file, 'utf8') : null,
  }));
}

function restoreServiceWorkers(backups) {
  for (const { file, contents } of backups) {
    if (contents === null) {
      if (existsSync(file)) unlinkSync(file);
    } else {
      writeFileSync(file, contents, 'utf8');
    }
  }
}

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

function serviceWorkerConfigs() {
  return SERVICE_WORKERS.map((file) => {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
    assert.ok(match, `${file} should initialize Firebase`);
    return JSON.parse(match[1]);
  });
}

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase web config into both service workers', () => {
    const backups = backupServiceWorkers();
    try {
      const result = runGenerator(cleanEnv(EXPLICIT_FIREBASE_ENV));
      assert.equal(result.status, 0, result.stderr || result.stdout);

      for (const config of serviceWorkerConfigs()) {
        assert.deepEqual(config, EXPLICIT_CONFIG);
      }
    } finally {
      restoreServiceWorkers(backups);
    }
  });

  it('uses local placeholders on Netlify unless Firebase injection is enabled', () => {
    const backups = backupServiceWorkers();
    try {
      const result = runGenerator(
        cleanEnv({
          ...EXPLICIT_FIREBASE_ENV,
          NETLIFY: 'true',
        }),
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);

      for (const config of serviceWorkerConfigs()) {
        assert.notEqual(config.apiKey, EXPLICIT_CONFIG.apiKey);
        assert.equal(config.projectId, 'demo-share-crops');
      }
    } finally {
      restoreServiceWorkers(backups);
    }
  });
});
