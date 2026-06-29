#!/usr/bin/env node
/**
 * Firebase Hosting prebuild: drop the Vercel API bundle (static SPA only) and
 * ensure production Firebase web config is present for vite build.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERCEL_FALLBACK_API_BASE,
  FIREBASE_HOSTING_HOSTNAME,
} from './domains.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_BUNDLE = join(ROOT, 'api', 'index.js');

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

if (existsSync(API_BUNDLE)) {
  unlinkSync(API_BUNDLE);
  console.log('firebase-prebuild: removed api/index.js (Vercel bundle not used on Firebase Hosting)');
}

const missing = FIREBASE_KEYS.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(
    `firebase-prebuild: missing Firebase web config: ${missing.join(', ')}`,
  );
  console.error('Set these in the deploy environment (see .github/workflows/firebase-deploy.yml).');
  process.exit(1);
}

if (!process.env.VITE_FALLBACK_API_URL?.trim()) {
  process.env.VITE_FALLBACK_API_URL = VERCEL_FALLBACK_API_BASE;
  console.log(`firebase-prebuild: VITE_FALLBACK_API_URL → ${VERCEL_FALLBACK_API_BASE}`);
}

console.log(`firebase-prebuild: ready for static SPA build (${FIREBASE_HOSTING_HOSTNAME})`);
