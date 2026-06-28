#!/usr/bin/env node
/**
 * Production setup helper for https://share-crops-marketplace.vercel.app
 *
 * Run on your machine (not in cloud agents — needs your Vercel/Firebase login):
 *   node scripts/configure-production.mjs
 *
 * Or step by step:
 *   node scripts/configure-production.mjs --print-env   # copy into Vercel dashboard
 *   node scripts/configure-production.mjs --firebase      # deploy auth config
 *   node scripts/configure-production.mjs --deploy        # vercel --prod
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PRODUCTION_ORIGIN = 'https://share-crops-marketplace.vercel.app';
const API_BASE = `${PRODUCTION_ORIGIN}/api/make-server-dd877831`;

/** Public Firebase web config — same values as public/firebase-messaging-sw.js */
export const PRODUCTION_ENV = {
  VITE_FIREBASE_API_KEY: 'AIzaSyCEI7ej1xjvuv7BPfTo8GbSnPCkULiKjIU',
  VITE_FIREBASE_AUTH_DOMAIN: 'share-crops-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'share-crops-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '764953465643',
  VITE_FIREBASE_APP_ID: '1:764953465643:web:9433426e334aed02a4eb6e',
  FIREBASE_PROJECT_ID: 'share-crops-app',
  VITE_FALLBACK_API_URL: API_BASE,
  CORS_ORIGINS: `${PRODUCTION_ORIGIN},http://localhost:5173,http://localhost:4321`,
  DEFAULT_ORIGIN: PRODUCTION_ORIGIN,
};

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
  for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
    console.log(`${key}=${value}`);
  }
  console.log('\nAlso confirm server-only secrets are already set:');
  console.log('  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,');
  console.log('  ADMIN_EMAIL, APP_ID, KV_TABLE_NAME, STORAGE_BUCKET_NAME, SKIP_INIT=true');
  console.log('\nFirebase Console → Authentication → Settings → Authorized domains:');
  console.log('  share-crops-marketplace.vercel.app');
  console.log('  localhost');
}

function deployFirebase() {
  return run('npx', ['-y', 'firebase-tools@latest', 'deploy', '--only', 'auth', '--project', 'share-crops-app']);
}

function deployVercel() {
  return run('npx', ['-y', 'vercel@latest', '--prod']);
}

console.log(`Share Crops production setup → ${PRODUCTION_ORIGIN}`);

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
  console.log(`  ${PRODUCTION_ORIGIN}/login → Continue with Google`);
  console.log(`  curl ${API_BASE}/health`);
}

process.exit(ok ? 0 : 1);
