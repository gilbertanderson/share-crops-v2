import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const ENV_LOCAL = join(ROOT, '.env.local');
const ENV_PRODUCTION_LOCAL = join(ROOT, '.env.production.local');
const OUTPUTS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];
const MUTATED_FILES = [ENV_LOCAL, ENV_PRODUCTION_LOCAL, ...OUTPUTS];

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
};

const LOCAL_ENV = {
  VITE_FIREBASE_API_KEY: 'local-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-share-crops.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

let backups;

function readMaybe(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function restoreFile(file, contents) {
  if (contents === null) {
    rmSync(file, { force: true });
    return;
  }
  writeFileSync(file, contents, 'utf8');
}

function writeEnvFile(file, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function resetEnvFiles() {
  rmSync(ENV_LOCAL, { force: true });
  rmSync(ENV_PRODUCTION_LOCAL, { force: true });
}

function runGenerator(extraEnv = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ...extraEnv,
  };
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function readOutputs() {
  return OUTPUTS.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('generate-sw.mjs', () => {
  beforeEach(() => {
    backups = new Map(MUTATED_FILES.map((file) => [file, readMaybe(file)]));
    resetEnvFiles();
  });

  afterEach(() => {
    for (const [file, contents] of backups) restoreFile(file, contents);
  });

  it('renders explicit Firebase config into both service workers', () => {
    const result = runGenerator(PRODUCTION_ENV);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const output of OUTPUTS) {
      const generated = readFileSync(output, 'utf8');
      assert.match(generated, /firebase\.initializeApp\(/);
      assert.match(generated, /"apiKey": "prod-api-key"/);
      assert.match(generated, /"projectId": "share-crops-app"/);
      assert.doesNotMatch(generated, /fake-api-key|local-api-key/);
    }
  });

  it('does not allow production builds to fall back to .env.local or dev defaults', () => {
    writeEnvFile(ENV_LOCAL, LOCAL_ENV);

    const result = runGenerator({ NODE_ENV: 'production' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required Firebase env vars for production build/);
    for (const key of FIREBASE_KEYS) assert.match(result.stderr, new RegExp(key));
  });

  it('uses .env.production.local instead of .env.local during production builds', () => {
    writeEnvFile(ENV_LOCAL, LOCAL_ENV);
    writeEnvFile(ENV_PRODUCTION_LOCAL, PRODUCTION_ENV);

    const result = runGenerator({ NODE_ENV: 'production' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generated = readOutputs();
    assert.match(generated, /"apiKey": "prod-api-key"/);
    assert.match(generated, /"projectId": "share-crops-app"/);
    assert.doesNotMatch(generated, /local-api-key|demo-share-crops/);
  });

  it('keeps Netlify placeholder generation when Firebase injection is disabled', () => {
    const result = runGenerator({ NETLIFY: 'true', NODE_ENV: 'production' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generated = readOutputs();
    assert.match(generated, /"apiKey": "fake-api-key"/);
    assert.match(generated, /"projectId": "demo-share-crops"/);
  });
});
