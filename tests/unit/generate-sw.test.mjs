import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
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
  VITE_FIREBASE_API_KEY: 'explicit-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'explicit.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'explicit-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'explicit.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '111111111111',
  VITE_FIREBASE_APP_ID: '1:111111111111:web:explicit',
};

const PRODUCTION_FILE_ENV = {
  VITE_FIREBASE_API_KEY: 'production-file-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'production-file.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'production-file-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'production-file.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '222222222222',
  VITE_FIREBASE_APP_ID: '1:222222222222:web:production-file',
};

const LOCAL_FILE_ENV = {
  VITE_FIREBASE_API_KEY: 'local-file-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local-file.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-file-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'local-file.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '333333333333',
  VITE_FIREBASE_APP_ID: '1:333333333333:web:local-file',
};

const pathsToRestore = [SW, FCM_SW, ENV_LOCAL, ENV_PRODUCTION_LOCAL];
let originals;

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function restore(path, contents) {
  if (contents === null) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, contents, 'utf8');
}

function removeEnvFiles() {
  for (const path of [ENV_LOCAL, ENV_PRODUCTION_LOCAL]) {
    if (existsSync(path)) unlinkSync(path);
  }
}

function writeEnvFile(path, values) {
  writeFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    'utf8',
  );
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_KEYS) delete env[key];
  delete env.CI;
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  delete env.NODE_ENV;
  delete env.VERCEL;
  return { ...env, ...extra };
}

function runGenerate(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function generatedOutputs() {
  return [readFileSync(SW, 'utf8'), readFileSync(FCM_SW, 'utf8')];
}

function assertConfigRendered(values) {
  for (const output of generatedOutputs()) {
    for (const value of Object.values(values)) {
      assert.ok(output.includes(value), `expected generated service worker to include ${value}`);
    }
  }
}

describe('generate-sw.mjs', { concurrency: false }, () => {
  before(() => {
    originals = new Map(pathsToRestore.map((path) => [path, readIfExists(path)]));
  });

  after(() => {
    for (const [path, contents] of originals) restore(path, contents);
  });

  it('renders explicit Firebase config into both service workers', () => {
    removeEnvFiles();
    const result = runGenerate(cleanEnv({ ...EXPLICIT_ENV, NODE_ENV: 'production' }));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertConfigRendered(EXPLICIT_ENV);
  });

  it('uses .env.production.local instead of local dummy config for production builds', () => {
    removeEnvFiles();
    writeEnvFile(ENV_LOCAL, LOCAL_FILE_ENV);
    writeEnvFile(ENV_PRODUCTION_LOCAL, PRODUCTION_FILE_ENV);

    const result = runGenerate(cleanEnv({ NODE_ENV: 'production' }));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertConfigRendered(PRODUCTION_FILE_ENV);

    for (const output of generatedOutputs()) {
      assert.doesNotMatch(output, /local-file-api-key/);
      assert.doesNotMatch(output, /local-file-project/);
    }
  });

  it('fails production builds when Firebase config is missing', () => {
    removeEnvFiles();
    const result = runGenerate(cleanEnv({ NODE_ENV: 'production' }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /missing required Firebase env vars/);
    assert.match(result.stderr + result.stdout, /VITE_FIREBASE_API_KEY/);
  });

  it('keeps Netlify placeholder mode isolated from production env requirements', () => {
    removeEnvFiles();
    const result = runGenerate(cleanEnv({ NETLIFY: 'true', NODE_ENV: 'production' }));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertConfigRendered({
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_PROJECT_ID: 'demo-share-crops',
    });
  });
});
