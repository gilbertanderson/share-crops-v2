import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');
const ENV_LOCAL = join(ROOT, '.env.local');
const ENV_PRODUCTION_LOCAL = join(ROOT, '.env.production.local');
const GENERATED_FILES = [SW, FCM_SW, ENV_LOCAL, ENV_PRODUCTION_LOCAL];

const PRODUCTION_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
};

const LOCAL_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'local-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'local-share-crops.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1111111111',
  VITE_FIREBASE_APP_ID: '1:1111111111:web:local',
};

let backups;

function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('VITE_FIREBASE_') &&
        !['CI', 'NETLIFY', 'NETLIFY_INJECT_FIREBASE', 'NODE_ENV', 'VERCEL'].includes(key),
    ),
  );
  return { ...env, ...extra };
}

function writeDotEnv(path, values) {
  writeFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    'utf8',
  );
}

function runGenerateSw(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function readGeneratedConfig(path) {
  const contents = readFileSync(path, 'utf8');
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, `expected Firebase config in ${path}`);
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  beforeEach(() => {
    backups = new Map(
      GENERATED_FILES.map((path) => [
        path,
        existsSync(path) ? { exists: true, contents: readFileSync(path, 'utf8') } : { exists: false },
      ]),
    );
  });

  afterEach(() => {
    for (const [path, backup] of backups) {
      if (backup.exists) {
        writeFileSync(path, backup.contents, 'utf8');
      } else {
        rmSync(path, { force: true });
      }
    }
  });

  it('renders explicit Firebase config into both service workers', () => {
    const result = runGenerateSw(cleanEnv(PRODUCTION_FIREBASE_ENV));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const path of [SW, FCM_SW]) {
      assert.deepEqual(readGeneratedConfig(path), {
        apiKey: 'prod-api-key',
        authDomain: 'share-crops-app.firebaseapp.com',
        projectId: 'share-crops-app',
        storageBucket: 'share-crops-app.firebasestorage.app',
        messagingSenderId: '764953465643',
        appId: '1:764953465643:web:9433426e334aed02a4eb6e',
      });
    }
  });

  it('does not use local dev Firebase config for production builds', () => {
    writeDotEnv(ENV_LOCAL, LOCAL_FIREBASE_ENV);
    rmSync(ENV_PRODUCTION_LOCAL, { force: true });
    const before = readFileSync(SW, 'utf8');

    const result = runGenerateSw(cleanEnv({ CI: 'true' }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /missing required Firebase env vars/);
    assert.equal(readFileSync(SW, 'utf8'), before);
  });

  it('uses production-local Firebase config instead of local dev config in production builds', () => {
    writeDotEnv(ENV_LOCAL, LOCAL_FIREBASE_ENV);
    writeDotEnv(ENV_PRODUCTION_LOCAL, PRODUCTION_FIREBASE_ENV);

    const result = runGenerateSw(cleanEnv({ CI: 'true' }));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readGeneratedConfig(SW).apiKey, 'prod-api-key');
    assert.equal(readGeneratedConfig(SW).projectId, 'share-crops-app');
  });

  it('keeps Netlify placeholder mode isolated from production env requirements', () => {
    const result = runGenerateSw(cleanEnv({ NETLIFY: 'true' }));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readGeneratedConfig(SW).apiKey, 'fake-api-key');
    assert.equal(readGeneratedConfig(SW).projectId, 'demo-share-crops');
  });
});
