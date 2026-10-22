import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SW = join(ROOT, 'public/sw.js');
const MESSAGING_SW = join(ROOT, 'public/firebase-messaging-sw.js');
const ENV_LOCAL = join(ROOT, '.env.local');
const ENV_PRODUCTION_LOCAL = join(ROOT, '.env.production.local');

const TEST_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'unit-test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'unit-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'unit-test-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'unit-test-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '9876543210',
  VITE_FIREBASE_APP_ID: '1:9876543210:web:unit-test',
};

const LOCAL_FIREBASE_ENV = {
  VITE_FIREBASE_API_KEY: 'local-dummy-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local-dummy.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-dummy-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'local-dummy-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:local-dummy',
};

const NETLIFY_PLACEHOLDER_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

const BACKED_UP_FILES = [SW, MESSAGING_SW, ENV_LOCAL, ENV_PRODUCTION_LOCAL];

let backups;

function firebaseConfigFromEnv(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

function envFileContents(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function baseEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
  };
}

function runGenerate(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...baseEnv(), ...extraEnv },
    encoding: 'utf8',
  });
}

function readGeneratedConfigs() {
  return [SW, MESSAGING_SW].map((file) => {
    const content = readFileSync(file, 'utf8');
    const match = content.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
    assert.ok(match, `${file} should initialize Firebase with an object literal`);
    assert.equal(content.includes('__FIREBASE_CONFIG__'), false);
    return JSON.parse(match[1]);
  });
}

beforeEach(() => {
  backups = new Map(
    BACKED_UP_FILES.map((file) => [
      file,
      existsSync(file) ? readFileSync(file, 'utf8') : null,
    ]),
  );
});

afterEach(() => {
  for (const [file, content] of backups) {
    if (content === null) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, content, 'utf8');
    }
  }
});

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase env into both service workers', () => {
    const result = runGenerate(TEST_FIREBASE_ENV);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /generated service workers/);
    for (const config of readGeneratedConfigs()) {
      assert.deepEqual(config, firebaseConfigFromEnv(TEST_FIREBASE_ENV));
    }
  });

  it('uses .env.production.local instead of dummy .env.local during production builds', () => {
    writeFileSync(ENV_LOCAL, envFileContents(LOCAL_FIREBASE_ENV), 'utf8');
    writeFileSync(ENV_PRODUCTION_LOCAL, envFileContents(TEST_FIREBASE_ENV), 'utf8');

    const result = runGenerate({ CI: 'true' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const config of readGeneratedConfigs()) {
      assert.deepEqual(config, firebaseConfigFromEnv(TEST_FIREBASE_ENV));
      assert.notEqual(config.projectId, LOCAL_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID);
    }
  });

  it('fails production builds when only local development Firebase config exists', () => {
    writeFileSync(ENV_LOCAL, envFileContents(LOCAL_FIREBASE_ENV), 'utf8');
    rmSync(ENV_PRODUCTION_LOCAL, { force: true });

    const result = runGenerate({ CI: 'true' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required Firebase env vars/);
    assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
  });

  it('keeps Netlify placeholder config unless Firebase injection is explicitly enabled', () => {
    const result = runGenerate({ ...TEST_FIREBASE_ENV, NETLIFY: 'true' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const config of readGeneratedConfigs()) {
      assert.deepEqual(config, NETLIFY_PLACEHOLDER_CONFIG);
      assert.notEqual(config.projectId, TEST_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID);
    }
  });
});
