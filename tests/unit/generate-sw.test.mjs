import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const OUTPUTS = [
  join(ROOT, 'public', 'sw.js'),
  join(ROOT, 'public', 'firebase-messaging-sw.js'),
];

const EXPLICIT_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'explicit-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'explicit.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'explicit-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'explicit-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '987654321',
  VITE_FIREBASE_APP_ID: '1:987654321:web:explicit',
};

const EXPECTED_EXPLICIT_CONFIG = {
  apiKey: 'explicit-api-key',
  authDomain: 'explicit.firebaseapp.com',
  projectId: 'explicit-project',
  storageBucket: 'explicit-project.firebasestorage.app',
  messagingSenderId: '987654321',
  appId: '1:987654321:web:explicit',
};

const EXPECTED_NETLIFY_PLACEHOLDER_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

const originalOutputs = new Map(
  OUTPUTS.map((file) => [file, existsSync(file) ? readFileSync(file, 'utf8') : null]),
);

afterEach(() => {
  for (const [file, contents] of originalOutputs) {
    if (contents !== null) writeFileSync(file, contents, 'utf8');
  }
});

function runGenerateSw(extraEnv) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      NETLIFY: '',
      NETLIFY_INJECT_FIREBASE: '',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function generatedConfigs() {
  return OUTPUTS.map((file) => {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
    assert.ok(match, `${file} should initialize Firebase with a literal config`);
    assert.doesNotMatch(source, /__FIREBASE_CONFIG__/);
    return JSON.parse(match[1]);
  });
}

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase web config into both service workers', () => {
    const result = runGenerateSw(EXPLICIT_FIREBASE_ENV);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /generated service workers/);
    assert.deepEqual(generatedConfigs(), [
      EXPECTED_EXPLICIT_CONFIG,
      EXPECTED_EXPLICIT_CONFIG,
    ]);
  });

  it('uses placeholders for Netlify static builds unless Firebase injection is enabled', () => {
    const result = runGenerateSw({
      ...EXPLICIT_FIREBASE_ENV,
      NETLIFY: 'true',
      NETLIFY_INJECT_FIREBASE: '',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(generatedConfigs(), [
      EXPECTED_NETLIFY_PLACEHOLDER_CONFIG,
      EXPECTED_NETLIFY_PLACEHOLDER_CONFIG,
    ]);
  });
});
