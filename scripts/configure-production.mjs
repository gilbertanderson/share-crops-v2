#!/usr/bin/env node
/**
 * Production setup helper.
 *
 * Main app URL:     https://share-crops-v2.vercel.app
 * Fallback app URL: https://share-crops-marketplace.vercel.app
 * Firebase auth:    share-crops-app.firebaseapp.com
 *
 * Run on your machine (needs Vercel + Firebase login):
 *   npm run configure:production
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_APP_ORIGIN,
  FALLBACK_APP_ORIGIN,
  FALLBACK_API_BASE,
  FIREBASE_AUTH_DOMAIN,
  PRIMARY_API_BASE,
  PRIMARY_HOSTNAME,
  FALLBACK_HOSTNAME,
} from './domains.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Firebase web config from env — never hardcode API keys in the repo. */
function productionFirebaseEnv() {
  const keys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ];
  const fromEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]?.trim()]));
  const projectId = fromEnv.VITE_FIREBASE_PROJECT_ID;
  return {
    ...fromEnv,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID?.trim() || projectId || '',
    VITE_FALLBACK_API_URL: FALLBACK_API_BASE,
    CORS_ORIGINS: `${PRIMARY_APP_ORIGIN},${FALLBACK_APP_ORIGIN},http://localhost:5173,http://localhost:4321`,
    DEFAULT_ORIGIN: PRIMARY_APP_ORIGIN,
  };
}

export const PRODUCTION_ENV = productionFirebaseEnv();

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;

function run(cmd, cmdArgs) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return (result.status ?? 1) === 0;
}

function printEnv() {
  console.log('\nPaste these in Vercel → Project → Settings → Environment Variables');
  console.log('(Production + Preview for each VITE_* and FIREBASE_PROJECT_ID)\n');
  const missing = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ].filter((k) => !PRODUCTION_ENV[k]);
  if (missing.length) {
    console.error('Missing Firebase config in your shell environment. Export these first:');
    for (const key of missing) console.error(`  export ${key}=...`);
    console.error('\nFetch values with:');
    console.error('  npx -y firebase-tools@latest apps:sdkconfig WEB <APP_ID> --project share-crops-app\n');
    process.exit(1);
  }
  if (PRODUCTION_ENV.VITE_FIREBASE_AUTH_DOMAIN !== FIREBASE_AUTH_DOMAIN) {
    console.warn(
      `\n⚠ VITE_FIREBASE_AUTH_DOMAIN should be ${FIREBASE_AUTH_DOMAIN}, not your Vercel URL.`,
    );
  }
  for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
    if (value) console.log(`${key}=${value}`);
  }
  console.log('\nDomain roles:');
  console.log(`  Primary (main):    ${PRIMARY_APP_ORIGIN}`);
  console.log(`  Fallback (backup): ${FALLBACK_APP_ORIGIN}`);
  console.log(`  Firebase auth:     ${FIREBASE_AUTH_DOMAIN}`);
  console.log('\nAlso confirm server-only secrets are already set:');
  console.log('  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,');
  console.log('  ADMIN_EMAIL, APP_ID, KV_TABLE_NAME, STORAGE_BUCKET_NAME, SKIP_INIT=true');
  console.log('\nOptional — stable listing/profile image URLs (no signed-URL expiry):');
  console.log('  NETLIFY_BLOBS_SITE_ID  (Netlify site ID for sharecropsmarketplace)');
  console.log('  NETLIFY_BLOBS_TOKEN    (Netlify personal access token — Sensitive)');
  console.log('  See DEPLOY.md §5. Without both, /upload keeps using Supabase Storage.');
  console.log('\nFirebase Console → Authentication → Settings → Authorized domains:');
  console.log(`  ${PRIMARY_HOSTNAME}`);
  console.log(`  ${FALLBACK_HOSTNAME}`);
  console.log('  localhost');
}

function deployFirebase() {
  return run('npx', ['-y', 'firebase-tools@latest', 'deploy', '--only', 'auth', '--project', 'share-crops-app']);
}

function deployVercel() {
  return run('npx', ['-y', 'vercel@latest', '--prod']);
}

console.log('Share Crops production setup');
console.log(`  Primary:  ${PRIMARY_APP_ORIGIN}`);
console.log(`  Fallback: ${FALLBACK_APP_ORIGIN}`);

if (runAll || args.has('--print-env')) printEnv();

let ok = true;
if (runAll || args.has('--firebase')) {
  console.log('\n--- Firebase auth deploy ---');
  if (!deployFirebase()) {
    console.error('Firebase deploy failed. Run: npx firebase-tools login');
    ok = false;
  }
}
if (runAll || args.has('--deploy')) {
  console.log('\n--- Vercel production deploy ---');
  if (!deployVercel()) {
    console.error('Vercel deploy failed. Run: npx vercel login && npx vercel link');
    ok = false;
  }
}

if (runAll) {
  console.log('\n--- After deploy, test ---');
  console.log(`  ${PRIMARY_APP_ORIGIN}/login → Continue with Google`);
  console.log(`  curl ${PRIMARY_API_BASE}/health`);
  console.log(`  curl ${FALLBACK_API_BASE}/health`);
}

process.exit(ok ? 0 : 1);
