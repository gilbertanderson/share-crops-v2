import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const EXPLICIT_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'test-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:testappid',
};

const PRODUCTION_FILE_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-file-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'prod-file.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'prod-file',
  VITE_FIREBASE_STORAGE_BUCKET: 'prod-file.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '222222222222',
  VITE_FIREBASE_APP_ID: '1:222222222222:web:prodfile',
};

const LOCAL_FILE_ENV = {
  VITE_FIREBASE_API_KEY: 'local-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'local.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '333333333333',
  VITE_FIREBASE_APP_ID: '1:333333333333:web:local',
};

const DEV_DEFAULT_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

const RESTORE_FILES = [SW, FCM_SW, ENV_LOCAL, ENV_PRODUCTION_LOCAL];
let backups;

function toConfig(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

function cleanEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_KEYS) {
    delete env[key];
    delete env[`${key}_B64`];
  }
  for (const key of ['CI', 'NETLIFY', 'NETLIFY_INJECT_FIREBASE', 'NODE_ENV', 'VERCEL']) {
    delete env[key];
  }
  return { ...env, ...extraEnv };
}

function runGenerator(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv(extraEnv),
    encoding: 'utf8',
  });
}

function writeEnvFile(path, values) {
  writeFileSync(
    path,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    'utf8',
  );
}

function restoreFile(path, contents) {
  if (contents === null) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, contents, 'utf8');
}

function readGeneratedConfig(path) {
  const contents = readFileSync(path, 'utf8');
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, `expected Firebase config in ${path}`);
  return JSON.parse(match[1]);
}

beforeEach(() => {
  backups = new Map(RESTORE_FILES.map((path) => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]));
  for (const path of [ENV_LOCAL, ENV_PRODUCTION_LOCAL]) {
    if (existsSync(path)) unlinkSync(path);
  }
});

afterEach(() => {
  for (const [path, contents] of backups) restoreFile(path, contents);
});

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase config into both service workers', () => {
    const result = runGenerator(EXPLICIT_ENV);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(readGeneratedConfig(SW), toConfig(EXPLICIT_ENV));
    assert.deepEqual(readGeneratedConfig(FCM_SW), toConfig(EXPLICIT_ENV));
    assert.match(readFileSync(SW, 'utf8'), /sharecrops-shell-v3/);
    assert.match(readFileSync(FCM_SW, 'utf8'), /DEPRECATED: FCM now runs inside \/sw\.js/);
  });

  it('uses .env.production.local instead of .env.local during production builds', () => {
    writeEnvFile(ENV_PRODUCTION_LOCAL, PRODUCTION_FILE_ENV);
    writeEnvFile(ENV_LOCAL, LOCAL_FILE_ENV);

    const result = runGenerator({ NODE_ENV: 'production' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(readGeneratedConfig(SW), toConfig(PRODUCTION_FILE_ENV));
    assert.deepEqual(readGeneratedConfig(FCM_SW), toConfig(PRODUCTION_FILE_ENV));
  });

  it('fails production builds when Firebase config is not supplied', () => {
    writeEnvFile(ENV_LOCAL, LOCAL_FILE_ENV);

    const result = runGenerator({ NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required Firebase env vars for production build/);
    assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
  });

  it('keeps Netlify placeholder mode isolated from production Firebase config', () => {
    writeEnvFile(ENV_PRODUCTION_LOCAL, PRODUCTION_FILE_ENV);

    const result = runGenerator({ NETLIFY: 'true' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(readGeneratedConfig(SW), DEV_DEFAULT_CONFIG);
    assert.deepEqual(readGeneratedConfig(FCM_SW), DEV_DEFAULT_CONFIG);
  });
});
