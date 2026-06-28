#!/usr/bin/env node
/**
 * Generate public/sw.js and public/firebase-messaging-sw.js from VITE_FIREBASE_*
 * environment variables. Keeps Firebase web config out of committed source so
 * Netlify (and other) secret scanners do not flag hardcoded API keys in the repo.
 *
 * Run automatically via npm prebuild / predev. Production builds (CI, Netlify,
 * Vercel) require the VITE_FIREBASE_* vars to be set in the host environment.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES = join(__dirname, 'templates');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

/** Local dev / Playwright placeholders — not real credentials. */
const DEV_DEFAULTS = {
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-share-crops.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function resolveFirebaseEnv() {
  const fileEnv = {
    ...loadDotEnv(join(ROOT, '.env.production.local')),
    ...loadDotEnv(join(ROOT, '.env.local')),
  };
  const merged = { ...DEV_DEFAULTS, ...fileEnv };
  for (const key of FIREBASE_KEYS) {
    if (process.env[key]?.trim()) merged[key] = process.env[key].trim();
  }
  return merged;
}

function isProductionBuild() {
  return (
    process.env.CI === 'true' ||
    process.env.NETLIFY === 'true' ||
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV === 'production'
  );
}

function firebaseConfigObject(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

function renderTemplate(templateName, config) {
  const template = readFileSync(join(TEMPLATES, templateName), 'utf8');
  const configLiteral = JSON.stringify(config, null, 2).replace(/\n/g, '\n');
  return template.replace('__FIREBASE_CONFIG__', configLiteral);
}

function main() {
  const env = resolveFirebaseEnv();
  const missing = FIREBASE_KEYS.filter((key) => !env[key]?.trim());

  if (missing.length && isProductionBuild()) {
    console.error('generate-sw: missing required Firebase env vars for production build:');
    for (const key of missing) console.error(`  - ${key}`);
    console.error('\nSet them in your host dashboard (Netlify/Vercel env vars).');
    console.error('These are public client config values — do not mark them as "secret".');
    process.exit(1);
  }

  const config = firebaseConfigObject(env);
  const outputs = [
    { template: 'sw-shell.js', out: 'public/sw.js' },
    { template: 'sw-fcm-deprecated.js', out: 'public/firebase-messaging-sw.js' },
  ];

  for (const { template, out } of outputs) {
    const dest = join(ROOT, out);
    writeFileSync(dest, renderTemplate(template, config));
  }

  console.log('✓ generated service workers from VITE_FIREBASE_* env');
}

main();
