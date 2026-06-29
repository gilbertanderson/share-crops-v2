#!/usr/bin/env node
/**
 * Assemble Vercel Build Output API artifacts after vite build + api bundle.
 *
 * With outputDirectory: "dist", Vercel ignores api/index.js written outside
 * dist/ during the build — /api/* then 404s. Emitting .vercel/output explicitly
 * deploys the SPA (static/) and the serverless function (functions/api/index.func/).
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const API_BUNDLE = join(ROOT, 'api', 'index.js');
const OUT = join(ROOT, '.vercel', 'output');
const STATIC = join(OUT, 'static');
const FUNC_DIR = join(OUT, 'functions', 'api', 'index.func');

if (process.env.NETLIFY === 'true' || process.env.FIREBASE_HOSTING === 'true') {
  console.log('build-vercel-output: skipped (static SPA build)');
  process.exit(0);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('Missing dist/index.html — run vite build first.');
  process.exit(1);
}

if (!existsSync(API_BUNDLE)) {
  console.error('Missing api/index.js — vite closeBundle must run scripts/build-api.mjs.');
  process.exit(1);
}

const bundleSize = statSync(API_BUNDLE).size;
if (bundleSize < 10_000) {
  console.error(`api/index.js looks too small (${bundleSize} bytes).`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STATIC, { recursive: true });
mkdirSync(FUNC_DIR, { recursive: true });

cpSync(DIST, STATIC, { recursive: true });
cpSync(API_BUNDLE, join(FUNC_DIR, 'index.js'));

writeFileSync(
  join(FUNC_DIR, '.vc-config.json'),
  `${JSON.stringify(
    {
      runtime: 'nodejs20.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      memory: 1024,
      maxDuration: 60,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(OUT, 'config.json'),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '/sw.js',
          headers: { 'Cache-Control': 'no-cache' },
          continue: true,
        },
        {
          src: '/(.*)',
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
          },
          continue: true,
        },
        { handle: 'filesystem' },
        {
          src: '/api/(.*)',
          dest: '/api/index?__path=$1',
        },
        {
          src: '/(.*)',
          dest: '/index.html',
        },
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(`✓ assembled .vercel/output (static SPA + api/index.func, ${bundleSize} byte bundle)`);
