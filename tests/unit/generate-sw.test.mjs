import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const OUTPUTS = [
  join(ROOT, 'public/sw.js'),
  join(ROOT, 'public/firebase-messaging-sw.js'),
];
const ENV_FILES = [
  join(ROOT, '.env.local'),
  join(ROOT, '.env.production.local'),
];
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
  VITE_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '111222333',
  VITE_FIREBASE_APP_ID: '1:111222333:web:testapp',
};

const LOCAL_ENV = {
  VITE_FIREBASE_API_KEY: 'local-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'local-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'local-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'local-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '444555666',
  VITE_FIREBASE_APP_ID: '1:444555666:web:localapp',
};

const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: 'production-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'production-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'production-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'production-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '777888999',
  VITE_FIREBASE_APP_ID: '1:777888999:web:productionapp',
};

function snapshot(paths) {
  return new Map(paths.map((path) => [
    path,
    existsSync(path) ? readFileSync(path, 'utf8') : null,
  ]));
}

const backup = snapshot([...OUTPUTS, ...ENV_FILES]);

function restore(paths, prior) {
  for (const path of paths) {
    const content = prior.get(path);
    if (content === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      writeFileSync(path, content, 'utf8');
    }
  }
}

function cleanEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const key of FIREBASE_KEYS) {
    delete env[key];
    delete env[`${key}_B64`];
  }
  delete env.CI;
  delete env.NETLIFY;
  delete env.NETLIFY_INJECT_FIREBASE;
  delete env.NODE_ENV;
  delete env.VERCEL;
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
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function readOutputs() {
  return OUTPUTS.map((path) => readFileSync(path, 'utf8'));
}

function assertOutputsInclude(values) {
  for (const output of readOutputs()) {
    for (const value of Object.values(values)) {
      assert.match(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
}

function assertOutputsExclude(values) {
  for (const output of readOutputs()) {
    for (const value of Object.values(values)) {
      assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
}

afterEach(() => {
  restore([...OUTPUTS, ...ENV_FILES], backup);
});

describe('generate-sw.mjs', () => {
  it('renders explicit Firebase env into both service workers', () => {
    const result = runGenerator(EXPLICIT_ENV);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertOutputsInclude(EXPLICIT_ENV);
    assertOutputsExclude({ fakeApiKey: 'fake-api-key' });
  });

  it('fails production builds instead of using local defaults', () => {
    writeEnvFile(join(ROOT, '.env.local'), LOCAL_ENV);

    const result = runGenerator({ CI: 'true' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required Firebase env vars/);
    assert.match(result.stderr, /VITE_FIREBASE_API_KEY/);
  });

  it('uses .env.production.local instead of .env.local for production builds', () => {
    writeEnvFile(join(ROOT, '.env.local'), LOCAL_ENV);
    writeEnvFile(join(ROOT, '.env.production.local'), PRODUCTION_ENV);

    const result = runGenerator({ CI: 'true' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertOutputsInclude(PRODUCTION_ENV);
    assertOutputsExclude(LOCAL_ENV);
  });

  it('accepts base64 encoded Firebase env values during production builds', () => {
    const encodedEnv = Object.fromEntries(
      Object.entries(EXPLICIT_ENV).map(([key, value]) => [
        `${key}_B64`,
        Buffer.from(value).toString('base64'),
      ]),
    );

    const result = runGenerator({ CI: 'true', ...encodedEnv });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertOutputsInclude(EXPLICIT_ENV);
  });

  it('keeps Netlify placeholder generation isolated from production env requirements', () => {
    const result = runGenerator({ NETLIFY: 'true' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertOutputsInclude({
      apiKey: 'fake-api-key',
      projectId: 'demo-share-crops',
      appId: '1:1234567890:web:abcdef',
    });
  });
});
