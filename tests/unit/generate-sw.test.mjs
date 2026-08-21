import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_SCRIPT = join(ROOT, 'scripts/generate-sw.mjs');
const SOURCE_TEMPLATES = join(ROOT, 'scripts/templates');
const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
const SANITIZED_ENV_KEYS = [
  ...FIREBASE_KEYS,
  ...FIREBASE_KEYS.map((key) => `${key}_B64`),
  'CI',
  'NETLIFY',
  'NETLIFY_INJECT_FIREBASE',
  'NODE_ENV',
  'VERCEL',
];

const DEMO_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-share-crops.firebaseapp.com',
  projectId: 'demo-share-crops',
  storageBucket: 'demo-share-crops.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};

const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: 'prod-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
};

const PRODUCTION_CONFIG = {
  apiKey: PRODUCTION_ENV.VITE_FIREBASE_API_KEY,
  authDomain: PRODUCTION_ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: PRODUCTION_ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: PRODUCTION_ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: PRODUCTION_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: PRODUCTION_ENV.VITE_FIREBASE_APP_ID,
};

let fixtureRoot;
let script;
let sw;
let fcmSw;

function cleanEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const key of SANITIZED_ENV_KEYS) delete env[key];
  return { ...env, ...extraEnv };
}

function runGenerator(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: fixtureRoot,
    env: cleanEnv(extraEnv),
    encoding: 'utf8',
  });
}

function readGeneratedConfig(path) {
  const contents = readFileSync(path, 'utf8');
  const match = contents.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  assert.ok(match, `${path} should initialize Firebase`);
  return JSON.parse(match[1]);
}

function assertBothWorkersUse(config) {
  assert.deepEqual(readGeneratedConfig(sw), config);
  assert.deepEqual(readGeneratedConfig(fcmSw), config);
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'share-crops-generate-sw-'));
  const fixtureScripts = join(fixtureRoot, 'scripts');
  mkdirSync(fixtureScripts, { recursive: true });
  mkdirSync(join(fixtureRoot, 'public'), { recursive: true });
  cpSync(SOURCE_SCRIPT, join(fixtureScripts, 'generate-sw.mjs'));
  cpSync(SOURCE_TEMPLATES, join(fixtureScripts, 'templates'), { recursive: true });
  script = join(fixtureScripts, 'generate-sw.mjs');
  sw = join(fixtureRoot, 'public/sw.js');
  fcmSw = join(fixtureRoot, 'public/firebase-messaging-sw.js');
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('generate-sw.mjs', () => {
  it('writes supplied Firebase config into both service workers', () => {
    const result = runGenerator(PRODUCTION_ENV);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertBothWorkersUse(PRODUCTION_CONFIG);

    const appShellWorker = readFileSync(sw, 'utf8');
    assert.match(appShellWorker, /const CACHE = 'sharecrops-shell-v3'/);
    assert.match(appShellWorker, /self\.addEventListener\('fetch'/);
    assert.match(readFileSync(fcmSw, 'utf8'), /DEPRECATED: FCM now runs inside \/sw\.js/);
  });

  it('uses demo Firebase placeholders when local config is absent', () => {
    const result = runGenerator();

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertBothWorkersUse(DEMO_CONFIG);
  });

  it('uses demo Firebase placeholders on Netlify when injection is disabled', () => {
    const result = runGenerator({
      NETLIFY: 'true',
      CI: 'true',
      ...PRODUCTION_ENV,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertBothWorkersUse(DEMO_CONFIG);
  });

  it('keeps injected Netlify Firebase config when injection is enabled', () => {
    const result = runGenerator({
      NETLIFY: 'true',
      NETLIFY_INJECT_FIREBASE: 'true',
      ...PRODUCTION_ENV,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertBothWorkersUse(PRODUCTION_CONFIG);
  });
});
