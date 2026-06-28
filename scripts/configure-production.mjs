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

/** Public Firebase web config — read from env; never hardcode API keys in the repo. */
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
    VITE_FALLBACK_API_URL: API_BASE,
    CORS_ORIGINS: `${PRODUCTION_ORIGIN},http://localhost:5173,http://localhost:4321`,
    DEFAULT_ORIGIN: PRODUCTION_ORIGIN,
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
    console.error('  npx -y firebase-tools@latest apps:sdkconfig WEB <APP_ID> --project <PROJECT_ID>\n');
    process.exit(1);
  }
  for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
    if (value) console.log(`${key}=${value}`);
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
