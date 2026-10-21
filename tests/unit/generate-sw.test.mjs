import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const OUTPUTS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const TEST_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'test-generated-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'generated.example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'generated-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'generated-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:generated',
};

const originalOutputs = new Map(
  OUTPUTS.map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]),
);

after(() => {
  for (const [path, contents] of originalOutputs) {
    if (contents !== null) writeFileSync(path, contents, 'utf8');
  }
});

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_ENV_KEYS) delete env[key];
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  return { ...env, ...overrides };
}

function runGenerateSw(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function generatedContents() {
  return OUTPUTS.map((path) => readFileSync(path, 'utf8'));
}

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase web config into both service worker outputs', () => {
    const result = runGenerateSw(cleanEnv(TEST_FIREBASE_ENV));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const contents of generatedContents()) {
      assert.match(contents, /firebase\.initializeApp\(\{/);
      assert.match(contents, /"apiKey": "test-generated-api-key"/);
      assert.match(contents, /"authDomain": "generated\.example\.firebaseapp\.com"/);
      assert.match(contents, /"projectId": "generated-project"/);
      assert.match(contents, /"storageBucket": "generated-project\.appspot\.com"/);
      assert.match(contents, /"messagingSenderId": "9876543210"/);
      assert.match(contents, /"appId": "1:9876543210:web:generated"/);
      assert.doesNotMatch(contents, /fake-api-key/);
    }
  });

  it('uses local placeholders on Netlify unless production injection is enabled', () => {
    const result = runGenerateSw(cleanEnv({ ...TEST_FIREBASE_ENV, NETLIFY: 'true' }));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const contents of generatedContents()) {
      assert.match(contents, /"apiKey": "fake-api-key"/);
      assert.match(contents, /"projectId": "demo-share-crops"/);
      assert.doesNotMatch(contents, /test-generated-api-key/);
      assert.doesNotMatch(contents, /generated-project/);
    }
  });
});
