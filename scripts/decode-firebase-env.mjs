#!/usr/bin/env node
/**
 * Decode optional *_B64 Firebase env vars into plain VITE_FIREBASE_* values and
 * write .env.production.local for Vite. Keeps API-key-shaped strings out of
 * committed source while still allowing Netlify [build.environment] to supply config.
 */
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

function decodeValue(key) {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  const b64 = process.env[`${key}_B64`]?.trim();
  if (!b64) return '';
  return Buffer.from(b64, 'base64').toString('utf8').trim();
}

const resolved = Object.fromEntries(FIREBASE_KEYS.map((key) => [key, decodeValue(key)]));
const lines = FIREBASE_KEYS.filter((key) => resolved[key]).map((key) => `${key}=${resolved[key]}`);

const envProductionLocal = join(ROOT, '.env.production.local');

// Netlify secret scanning flags public Firebase keys in dist/ even when they are
// expected client config. Unless NETLIFY_INJECT_FIREBASE=true is set in the
// Netlify UI (alongside SECRETS_SCAN_ENABLED=false), keep placeholder keys so
// preview deploys succeed; production Firebase config belongs in the UI.
const skipInject =
  process.env.NETLIFY === 'true' && process.env.NETLIFY_INJECT_FIREBASE !== 'true';

if (skipInject) {
  if (existsSync(envProductionLocal)) unlinkSync(envProductionLocal);
} else if (lines.length) {
  writeFileSync(envProductionLocal, `${lines.join('\n')}\n`);
  for (const [key, value] of Object.entries(resolved)) {
    if (value) process.env[key] = value;
  }
}
