import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts/build-vercel-output.mjs');
const BUILD_API = join(ROOT, 'scripts/build-api.mjs');
const API_BUNDLE = join(ROOT, 'api', 'index.js');
const OUT = join(ROOT, '.vercel/output');
const FUNC = join(OUT, 'functions/api/index.func/index.js');
const CONFIG = join(OUT, 'config.json');
const STATIC_INDEX = join(OUT, 'static/index.html');

describe('build-vercel-output.mjs', () => {
  before(() => {
    if (!existsSync(API_BUNDLE) || statSync(API_BUNDLE).size < 10_000) {
      const result = spawnSync(process.execPath, [BUILD_API], { cwd: ROOT, stdio: 'pipe' });
      assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
    }
  });

  it('assembles .vercel/output with static SPA and api function', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(STATIC_INDEX), true);
    assert.equal(existsSync(FUNC), true);
    assert.equal(existsSync(join(OUT, 'functions/api/index.func/.vc-config.json')), true);
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
    assert.equal(config.version, 3);
    assert.ok(config.routes.some((r) => r.dest === '/api/index?__path=$1'));
    assert.match(result.stdout, /assembled \.vercel\/output/);
  });

  it('skips on Netlify builds', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, NETLIFY: 'true' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /skipped/);
  });
});
