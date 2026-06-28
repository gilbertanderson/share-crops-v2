#!/usr/bin/env node
/**
 * Decode optional *_B64 Firebase env vars into plain VITE_FIREBASE_* values and
 * write .env.production.local for Vite. Keeps API-key-shaped strings out of
 * committed source while still allowing Netlify [build.environment] to supply config.
 */
import { writeFileSync } from 'node:fs';
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

if (lines.length) {
  writeFileSync(join(ROOT, '.env.production.local'), `${lines.join('\n')}\n`);
  for (const [key, value] of Object.entries(resolved)) {
    if (value) process.env[key] = value;
  }
}
