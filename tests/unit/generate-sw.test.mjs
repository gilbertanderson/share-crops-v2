import { readFileSync, writeFileSync } from 'node:fs';
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

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const PRODUCTION_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'production-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:production',
};

function snapshotWorkers() {
  return new Map(WORKERS.map((path) => [path, readFileSync(path, 'utf8')]));
}

function restoreWorkers(snapshot) {
  for (const [path, contents] of snapshot) {
    writeFileSync(path, contents, 'utf8');
  }
}

function testEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_KEYS) {
    delete env[key];
    delete env[`${key}_B64`];
  }
  delete env.CI;
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  delete env.NODE_ENV;
  delete env.VERCEL;
  return { ...env, ...overrides };
}

function runGenerator(overrides) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: testEnv(overrides),
    encoding: 'utf8',
  });
}

function readGeneratedWorkers() {
  return WORKERS.map((path) => readFileSync(path, 'utf8'));
}

describe('generate-sw.mjs', () => {
  it('writes production Firebase config from VITE_FIREBASE_* env to both service workers', () => {
    const prior = snapshotWorkers();
    try {
      const result = runGenerator({
        ...PRODUCTION_FIREBASE_ENV,
        NODE_ENV: 'production',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const contents of readGeneratedWorkers()) {
        assert.match(contents, /"apiKey": "production-api-key"/);
        assert.match(contents, /"projectId": "share-crops-app"/);
        assert.match(contents, /"storageBucket": "share-crops-app\.firebasestorage\.app"/);
        assert.doesNotMatch(contents, /"apiKey": "fake-api-key"/);
        assert.doesNotMatch(contents, /"projectId": "demo-share-crops"/);
      }
    } finally {
      restoreWorkers(prior);
    }
  });

  it('keeps Netlify service workers on placeholder config unless Firebase injection is enabled', () => {
    const prior = snapshotWorkers();
    try {
      const result = runGenerator({
        ...PRODUCTION_FIREBASE_ENV,
        NETLIFY: 'true',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const contents of readGeneratedWorkers()) {
        assert.match(contents, /"apiKey": "fake-api-key"/);
        assert.match(contents, /"projectId": "demo-share-crops"/);
        assert.doesNotMatch(contents, /"apiKey": "production-api-key"/);
        assert.doesNotMatch(contents, /"projectId": "share-crops-app"/);
      }
    } finally {
      restoreWorkers(prior);
    }
  });
});
