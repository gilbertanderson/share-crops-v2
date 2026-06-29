#!/usr/bin/env node
/**
 * Netlify-only prebuild: drop the committed Vercel API bundle from the workspace
 * so post-build secret scanning does not flag example tokens embedded in
 * upstream SDK docs inside api/index.js. The static SPA does not use /api.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_BUNDLE = join(ROOT, 'api', 'index.js');

/** Local dev placeholders only — never override real Netlify/Vercel env. */
const PLACEHOLDER_FIREBASE = {
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-share-crops.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

if (existsSync(API_BUNDLE)) {
  unlinkSync(API_BUNDLE);
  console.log('netlify-prebuild: removed api/index.js (Vercel bundle not used on Netlify)');
}

// Only fill missing Firebase vars. When NETLIFY_INJECT_FIREBASE=true (netlify.toml),
// real share-crops-app values from build.environment must not be replaced with demo-*.
const usePlaceholders = process.env.NETLIFY_INJECT_FIREBASE !== 'true';
for (const [key, value] of Object.entries(PLACEHOLDER_FIREBASE)) {
  if (usePlaceholders && !process.env[key]?.trim()) {
    process.env[key] = value;
  }
}

if (usePlaceholders) {
  console.log('netlify-prebuild: using demo Firebase placeholders (set NETLIFY_INJECT_FIREBASE=true for production)');
} else {
  console.log('netlify-prebuild: keeping injected Firebase config for share-crops-app');
}

console.log('netlify-prebuild: ready for static SPA build');
