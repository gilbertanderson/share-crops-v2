import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/netlify-prebuild.mjs');
const API_BUNDLE = join(ROOT, 'api', 'index.js');

describe('netlify-prebuild.mjs', () => {
  it('removes api/index.js when present', () => {
    const prior = existsSync(API_BUNDLE) ? readFileSync(API_BUNDLE, 'utf8') : null;
    writeFileSync(API_BUNDLE, '// temporary test bundle\n', 'utf8');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, NETLIFY: 'true' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(API_BUNDLE), false);
    if (prior) writeFileSync(API_BUNDLE, prior, 'utf8');
  });

  it('runs successfully when api/index.js is already absent', () => {
    const prior = existsSync(API_BUNDLE) ? readFileSync(API_BUNDLE, 'utf8') : null;
    if (existsSync(API_BUNDLE)) unlinkSync(API_BUNDLE);
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, NETLIFY: 'true' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /ready for static SPA build/);
    if (prior) writeFileSync(API_BUNDLE, prior, 'utf8');
  });
});
