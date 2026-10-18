import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = new URL('../../scripts/generate-sw.mjs', import.meta.url).pathname;
const OUTPUTS = [
  new URL('../../public/sw.js', import.meta.url).pathname,
  new URL('../../public/firebase-messaging-sw.js', import.meta.url).pathname,
];

const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'prod-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'prod-test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'prod-test.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:prodtest',
};

const DEV_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

const backups = new Map(
  OUTPUTS.map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]),
);

after(() => {
  for (const [path, contents] of backups) {
    if (contents === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      writeFileSync(path, contents, 'utf8');
    }
  }
});

function runGenerator(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      NETLIFY: '',
      NETLIFY_INJECT_FIREBASE: '',
      NODE_ENV: '',
      VERCEL: '',
      CI: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function readGeneratedConfigs() {
  return OUTPUTS.map((path) => {
    const source = readFileSync(path, 'utf8');
    const match = source.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
    assert.ok(match, `${path} should initialize Firebase`);
    return JSON.parse(match[1]);
  });
}

describe('generate-sw.mjs', () => {
  it('renders explicit production Firebase config into both service workers', () => {
    const result = runGenerator({
      VERCEL: '1',
      ...PRODUCTION_ENV,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const expected = {
      apiKey: PRODUCTION_ENV.VITE_FIREBASE_API_KEY,
      authDomain: PRODUCTION_ENV.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: PRODUCTION_ENV.VITE_FIREBASE_PROJECT_ID,
      storageBucket: PRODUCTION_ENV.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: PRODUCTION_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: PRODUCTION_ENV.VITE_FIREBASE_APP_ID,
    };
    for (const config of readGeneratedConfigs()) {
      assert.deepEqual(config, expected);
      assert.notEqual(config.projectId, DEV_CONFIG.projectId);
    }
  });

  it('keeps Netlify placeholder mode isolated from host Firebase env vars', () => {
    const result = runGenerator({
      NETLIFY: 'true',
      // The fallback Netlify site skips injection unless explicitly opted in.
      NETLIFY_INJECT_FIREBASE: '',
      ...PRODUCTION_ENV,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const config of readGeneratedConfigs()) {
      assert.deepEqual(config, DEV_CONFIG);
    }
  });
});
