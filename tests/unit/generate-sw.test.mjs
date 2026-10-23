import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const DOTENV_LOCAL = join(ROOT, '.env.local');
const DOTENV_PRODUCTION_LOCAL = join(ROOT, '.env.production.local');
const SW = join(ROOT, 'public/sw.js');
const FCM_SW = join(ROOT, 'public/firebase-messaging-sw.js');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const PROD_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'prod.example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'prod-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'prod-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '987654321',
  VITE_FIREBASE_APP_ID: '1:987654321:web:prod',
};

const LOCAL_ENV = {
  VITE_FIREBASE_API_KEY: 'local-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local.example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'local-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  VITE_FIREBASE_APP_ID: '1:123456789:web:local',
};

const ENV_FILES = [DOTENV_LOCAL, DOTENV_PRODUCTION_LOCAL];
const GENERATED_FILES = [SW, FCM_SW];

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function restoreFile(path, content) {
  if (content === null) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
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

function cleanEnv(overrides = {}) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...overrides };
}

function runGenerate(overrides = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: cleanEnv(overrides),
    encoding: 'utf8',
  });
}

function readGeneratedConfig(path = SW) {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, `expected Firebase config in ${path}`);
  return JSON.parse(match[1]);
}

describe('generate-sw.mjs', () => {
  const backups = new Map();

  beforeEach(() => {
    backups.clear();
    for (const path of [...ENV_FILES, ...GENERATED_FILES]) {
      backups.set(path, readIfExists(path));
    }
    for (const path of ENV_FILES) rmSync(path, { force: true });
  });

  afterEach(() => {
    for (const [path, content] of backups) restoreFile(path, content);
  });

  it('renders explicit Firebase env config into both service workers', () => {
    const result = runGenerate({ ...PROD_ENV, NODE_ENV: 'production' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readGeneratedConfig(SW), {
      apiKey: PROD_ENV.VITE_FIREBASE_API_KEY,
      authDomain: PROD_ENV.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: PROD_ENV.VITE_FIREBASE_PROJECT_ID,
      storageBucket: PROD_ENV.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: PROD_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: PROD_ENV.VITE_FIREBASE_APP_ID,
    });
    assert.deepEqual(readGeneratedConfig(FCM_SW), readGeneratedConfig(SW));
  });

  it('uses .env.production.local instead of dummy .env.local during production builds', () => {
    writeEnvFile(DOTENV_LOCAL, LOCAL_ENV);
    writeEnvFile(DOTENV_PRODUCTION_LOCAL, PROD_ENV);

    const result = runGenerate({ NODE_ENV: 'production' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readGeneratedConfig();
    assert.equal(config.apiKey, PROD_ENV.VITE_FIREBASE_API_KEY);
    assert.equal(config.projectId, PROD_ENV.VITE_FIREBASE_PROJECT_ID);
  });

  it('fails production builds when only local dummy config is present', () => {
    writeEnvFile(DOTENV_LOCAL, LOCAL_ENV);

    const result = runGenerate({ NODE_ENV: 'production' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /missing required Firebase env vars/);
    assert.match(result.stderr + result.stdout, /VITE_FIREBASE_API_KEY/);
  });

  it('keeps Netlify placeholder mode independent of host Firebase env vars', () => {
    const result = runGenerate({
      ...PROD_ENV,
      NETLIFY: 'true',
      NODE_ENV: 'production',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readGeneratedConfig();
    assert.equal(config.apiKey, 'fake-api-key');
    assert.equal(config.projectId, 'demo-share-crops');
  });
});
