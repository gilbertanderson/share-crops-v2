import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const ENV_LOCAL = join(ROOT, '.env.local');
const ENV_PROD_LOCAL = join(ROOT, '.env.production.local');
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

const BASE_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '12345',
  VITE_FIREBASE_APP_ID: '1:12345:web:test',
};

const PROD_FILE_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-file-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'prod-file.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'prod-file',
  VITE_FIREBASE_STORAGE_BUCKET: 'prod-file.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '67890',
  VITE_FIREBASE_APP_ID: '1:67890:web:prod',
};

const RESTORED_FILES = [ENV_LOCAL, ENV_PROD_LOCAL, SW, FCM_SW];
let backups;

function envFile(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

function writeEnvFile(path, values) {
  writeFileSync(path, envFile(values), 'utf8');
}

function restoreFiles() {
  for (const file of RESTORED_FILES) {
    const prior = backups.get(file);
    if (prior === null) {
      if (existsSync(file)) unlinkSync(file);
    } else {
      writeFileSync(file, prior, 'utf8');
    }
  }
}

function sanitizedEnv(extraEnv = {}) {
  const env = {
    ...process.env,
    CI: '',
    NETLIFY: '',
    NETLIFY_INJECT_FIREBASE: '',
    NODE_ENV: '',
    VERCEL: '',
    ...Object.fromEntries(FIREBASE_KEYS.flatMap((key) => [[key, ''], [`${key}_B64`, '']])),
    ...extraEnv,
  };
  return env;
}

function runGenerator(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: sanitizedEnv(extraEnv),
    encoding: 'utf8',
  });
}

describe('generate-sw.mjs', () => {
  beforeEach(() => {
    backups = new Map(
      RESTORED_FILES.map((file) => [file, existsSync(file) ? readFileSync(file, 'utf8') : null]),
    );
  });

  afterEach(() => {
    restoreFiles();
  });

  it('renders explicit Firebase environment values into both service workers', () => {
    const result = runGenerator(BASE_FIREBASE_ENV);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sw = readFileSync(SW, 'utf8');
    const fcmSw = readFileSync(FCM_SW, 'utf8');
    assert.match(sw, /"apiKey": "test-api-key"/);
    assert.match(sw, /"projectId": "test-project"/);
    assert.match(fcmSw, /"apiKey": "test-api-key"/);
    assert.match(fcmSw, /"projectId": "test-project"/);
  });

  it('accepts production config from .env.production.local without reading .env.local', () => {
    writeEnvFile(ENV_LOCAL, BASE_FIREBASE_ENV);
    writeEnvFile(ENV_PROD_LOCAL, PROD_FILE_ENV);

    const result = runGenerator({ CI: 'true' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sw = readFileSync(SW, 'utf8');
    assert.match(sw, /"apiKey": "prod-file-key"/);
    assert.doesNotMatch(sw, /test-api-key/);
  });

  it('fails production builds instead of falling back to .env.local or dev defaults', () => {
    writeEnvFile(ENV_LOCAL, BASE_FIREBASE_ENV);
    if (existsSync(ENV_PROD_LOCAL)) unlinkSync(ENV_PROD_LOCAL);

    const result = runGenerator({ CI: 'true' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required Firebase env vars/);
    assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
  });

  it('decodes VITE_FIREBASE_*_B64 values before rendering service workers', () => {
    const result = runGenerator({
      CI: 'true',
      ...Object.fromEntries(
        Object.entries(BASE_FIREBASE_ENV).map(([key, value]) => [
          `${key}_B64`,
          Buffer.from(value).toString('base64'),
        ]),
      ),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sw = readFileSync(SW, 'utf8');
    assert.match(sw, /"apiKey": "test-api-key"/);
    assert.match(sw, /"appId": "1:12345:web:test"/);
  });

  it('keeps Netlify placeholder mode for static fallback builds', () => {
    const result = runGenerator({ NETLIFY: 'true' });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const sw = readFileSync(SW, 'utf8');
    assert.match(sw, /"apiKey": "fake-api-key"/);
    assert.match(sw, /"projectId": "demo-share-crops"/);
  });
});
