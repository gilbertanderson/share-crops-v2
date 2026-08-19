import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts/build-vercel-output.mjs');
const BUILD_API = join(ROOT, 'scripts/build-api.mjs');
const API_BUNDLE = join(ROOT, 'api', 'index.js');
const DIST = join(ROOT, 'dist');
const DIST_INDEX = join(DIST, 'index.html');
const OUT = join(ROOT, '.vercel/output');
const FUNC_DIR = join(OUT, 'functions/api/index.func');
const FUNC = join(OUT, 'functions/api/index.func/index.js');
const CONFIG = join(OUT, 'config.json');
const STATIC_INDEX = join(OUT, 'static/index.html');

describe('build-vercel-output.mjs', () => {
  before(() => {
    mkdirSync(DIST, { recursive: true });
    writeFileSync(DIST_INDEX, '<!doctype html><html><body>test shell</body></html>\n');
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
    assert.equal(existsSync(join(FUNC_DIR, '.vc-config.json')), true);
    const funcPackage = JSON.parse(readFileSync(join(FUNC_DIR, 'package.json'), 'utf8'));
    assert.equal(funcPackage.type, 'module');
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
    assert.equal(config.version, 3);
    assert.ok(config.routes.some((r) => r.dest === '/api/index?__path=$1'));
    assert.match(result.stdout, /assembled \.vercel\/output/);

    const isolated = mkdtempSync(join(tmpdir(), 'share-crops-vercel-func-'));
    try {
      cpSync(FUNC_DIR, join(isolated, 'index.func'), { recursive: true });
      const check = spawnSync(process.execPath, ['--check', join(isolated, 'index.func/index.js')], {
        encoding: 'utf8',
      });
      assert.equal(check.status, 0, check.stderr || check.stdout);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
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
