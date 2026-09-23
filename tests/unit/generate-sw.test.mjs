import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public', 'sw.js');
const FCM_SW = join(ROOT, 'public', 'firebase-messaging-sw.js');

const originalOutputs = new Map([
  [SW, readFileSync(SW, 'utf8')],
  [FCM_SW, readFileSync(FCM_SW, 'utf8')],
]);

const FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-share-crops.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '246813579',
  VITE_FIREBASE_APP_ID: '1:246813579:web:unit-test',
};

function restoreServiceWorkers() {
  for (const [path, contents] of originalOutputs) {
    writeFileSync(path, contents, 'utf8');
  }
}

function runGenerator(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: 'false',
      NETLIFY: 'false',
      NETLIFY_INJECT_FIREBASE: 'false',
      NODE_ENV: 'test',
      VERCEL: '0',
      ...env,
    },
    encoding: 'utf8',
  });
}

function generatedConfigLiteral(env) {
  return JSON.stringify(
    {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    },
    null,
    2,
  );
}

describe('generate-sw.mjs', () => {
  it('renders both service workers from the same Firebase env config', () => {
    try {
      const result = runGenerator(FIREBASE_ENV);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const sw = readFileSync(SW, 'utf8');
      const fcmSw = readFileSync(FCM_SW, 'utf8');
      const expectedConfig = generatedConfigLiteral(FIREBASE_ENV);

      assert.match(result.stdout, /generated service workers/);
      assert.match(sw, /app-shell offline support \+ FCM background push/);
      assert.match(sw, /self\.addEventListener\('fetch'/);
      assert.match(sw, /url\.pathname\.startsWith\('\/api'\)/);
      assert.match(sw, /messaging\.onBackgroundMessage/);
      assert.match(fcmSw, /DEPRECATED: FCM now runs inside \/sw\.js/);
      assert.match(fcmSw, /messaging\.onBackgroundMessage/);
      assert.ok(sw.includes(expectedConfig));
      assert.ok(fcmSw.includes(expectedConfig));
      assert.doesNotMatch(sw + fcmSw, /__FIREBASE_CONFIG__/);
      assert.doesNotMatch(sw + fcmSw, /fake-api-key/);
    } finally {
      restoreServiceWorkers();
    }
  });

  it('keeps Netlify placeholder builds on local emulator defaults unless injection is enabled', () => {
    try {
      const result = runGenerator({
        ...FIREBASE_ENV,
        NETLIFY: 'true',
        NETLIFY_INJECT_FIREBASE: 'false',
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const sw = readFileSync(SW, 'utf8');
      const fcmSw = readFileSync(FCM_SW, 'utf8');
      const combined = sw + fcmSw;

      assert.match(combined, /"apiKey": "fake-api-key"/);
      assert.match(combined, /"projectId": "demo-share-crops"/);
      assert.doesNotMatch(combined, /unit-api-key/);
      assert.doesNotMatch(combined, /unit-share-crops/);
    } finally {
      restoreServiceWorkers();
    }
  });
});
